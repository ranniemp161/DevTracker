import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  githubInstallations,
  githubInstallStates,
  githubRepositories,
  githubWorkspaceConnections,
  projects,
  lt,
  projectRepositories,
  users,
  type Database,
} from '@devtrack/database';
import {
  ErrorCode,
  type AvailableRepository,
  type AvailableGithubInstallation,
  type GithubRepositoryAccess,
  type GithubConnection,
  type GithubConnectionList,
} from '@devtrack/types';
import { generateToken, hashToken, safeEqual } from '../../common/crypto/tokens';
import { AppException } from '../../common/errors/app.exception';
import { isUuid } from '../../common/pipes/uuid-param.pipe';
import { GITHUB_INSTALL_STATE_TTL_MS } from '../../auth/auth-cookies.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import { EventRecorder } from '../../events/event-recorder.service';
import { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import { RepositoryAccess, type ConnectionRef } from '../access/repository-access.service';
import {
  GithubAppClient,
  GithubInstallationUnavailableError,
  type GithubInstallationInfo,
} from '../github-app.client';

export type InstallationRow = typeof githubInstallations.$inferSelect;
/** A workspace connection with its installation's row (`id` is the installation's). */
export type WorkspaceConnection = InstallationRow & {
  connectionId: string;
  workspaceId: string;
  /** The connection as RepositoryAccess takes it. */
  ref: ConnectionRef;
};
type InstallStateRow = typeof githubInstallStates.$inferSelect;

const stateInvalid = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.GITHUB_INSTALL_STATE_INVALID,
    'The GitHub installation session expired or is invalid. Start the installation again from DevTrack.',
  );

const notAuthorized = () =>
  new AppException(
    HttpStatus.FORBIDDEN,
    ErrorCode.GITHUB_INSTALL_NOT_AUTHORIZED,
    'GitHub did not confirm that you can manage this installation.',
  );

export const installationUnavailable = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.GITHUB_INSTALLATION_UNAVAILABLE,
    'This GitHub installation is suspended or was removed on GitHub.',
  );

const installationNotFound = () => AppException.notFound('GitHub installation not found.');

/**
 * GitHub App installation lifecycle (architecture §11.2, decision record 0005).
 *
 * Binding an installation to a workspace needs three proofs:
 * 1. the browser that returns from GitHub is the one that started the flow (state cookie);
 * 2. the DevTrack user who started it is still an Admin/Owner of the workspace;
 * 3. the GitHub user who completed it can access the installation on GitHub (user token
 *    from "Request user authorization during installation"), so a forged `installation_id`
 *    cannot attach someone else's repositories.
 */
@Injectable()
export class GithubInstallationsService {
  private readonly logger = new Logger(GithubInstallationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: WorkspaceAccessService,
    private readonly client: GithubAppClient,
    private readonly events: EventRecorder,
    private readonly repoAccess: RepositoryAccess,
  ) {}

  /** Returns GitHub's installation URL and the raw state for the browser-binding cookie. */
  async begin(
    userId: string,
    workspaceId: string,
    mode: 'install' | 'connect' = 'install',
  ): Promise<{ installUrl: string; state: string }> {
    await this.access.require(userId, workspaceId, 'ADMIN');
    const app = this.config.githubApp;
    if (!app) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.GITHUB_APP_NOT_CONFIGURED,
        'The GitHub App is not configured on this server.',
      );
    }

    // Opportunistic cleanup of abandoned flows (indexed on expires_at).
    await this.db.delete(githubInstallStates).where(lt(githubInstallStates.expiresAt, new Date()));

    const state = generateToken();
    await this.db.insert(githubInstallStates).values({
      mode,
      stateHash: hashToken(state),
      userId,
      workspaceId,
      expiresAt: new Date(Date.now() + GITHUB_INSTALL_STATE_TTL_MS),
    });
    const url = new URL(
      mode === 'connect'
        ? 'https://github.com/login/oauth/authorize'
        : `https://github.com/apps/${app.slug}/installations/new`,
    );
    if (mode === 'connect') {
      url.searchParams.set('client_id', app.clientId);
      url.searchParams.set(
        'redirect_uri',
        `${this.config.webOrigin}/api/v1/github/install/callback`,
      );
    }
    url.searchParams.set('state', state);
    return { installUrl: url.toString(), state };
  }

  /**
   * Validates and consumes the flow state (single use). The query `state` must equal the
   * browser's cookie and match an unexpired row.
   */
  async consumeState(state?: string, cookieState?: string): Promise<InstallStateRow> {
    if (!state || !cookieState || !safeEqual(state, cookieState)) throw stateInvalid();
    const [row] = await this.db
      .delete(githubInstallStates)
      .where(eq(githubInstallStates.stateHash, hashToken(state)))
      .returning();
    if (!row || row.mode === 'choose' || row.expiresAt.getTime() <= Date.now())
      throw stateInvalid();
    return row;
  }

  /**
   * Completes the installation for a consumed state. Returns `requested` when a GitHub
   * organization member asked an owner to approve the app (nothing is installed yet).
   */
  async complete(
    flow: InstallStateRow,
    params: { installationId?: string; code?: string; setupAction?: string },
  ): Promise<'installed' | 'requested'> {
    await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    if (flow.mode !== 'install') throw notAuthorized();
    if (params.setupAction === 'request') return 'requested';

    const githubInstallationId =
      params.installationId && /^\d{1,15}$/.test(params.installationId)
        ? Number(params.installationId)
        : null;
    if (!githubInstallationId || !params.code) throw notAuthorized();

    const userToken = await this.client.exchangeInstallCode(params.code);
    if (!userToken) throw notAuthorized();
    let info;
    let repositoryIds: number[] = [];
    try {
      info = await this.client.findUserInstallation(userToken, githubInstallationId);
      if (info)
        repositoryIds = (
          await this.client.listUserRepositories(userToken, githubInstallationId)
        ).map((r) => r.id);
    } finally {
      await this.client.revokeUserToken(userToken);
    }
    if (!info) throw notAuthorized();

    // Installation access alone is insufficient: only repos readable by this user may be delegated.
    await this.bind(flow, info, repositoryIds);
    return 'installed';
  }

  /** Reauthorize an existing installation without running GitHub's installation UI again. */
  async prepareExisting(flow: InstallStateRow, code?: string): Promise<string> {
    await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    if (flow.mode !== 'connect' || !code) throw notAuthorized();
    const token = await this.client.exchangeInstallCode(
      code,
      `${this.config.webOrigin}/api/v1/github/install/callback`,
    );
    if (!token) throw notAuthorized();
    const choices: NonNullable<InstallStateRow['verifiedInstallations']> = [];
    try {
      const installations = await this.client.listUserInstallations(token);
      for (const info of installations.filter((i) => !i.suspendedAt)) {
        const repos = await this.client.listUserRepositories(token, info.id);
        choices.push({ ...info, suspendedAt: null, repositoryIds: repos.map((r) => r.id) });
      }
    } finally {
      await this.client.revokeUserToken(token);
    }
    const state = generateToken();
    await this.db.insert(githubInstallStates).values({
      userId: flow.userId,
      workspaceId: flow.workspaceId,
      mode: 'choose',
      stateHash: hashToken(state),
      verifiedInstallations: choices,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return state;
  }

  private async choiceFlow(userId: string, workspaceId: string, cookie?: string) {
    await this.access.require(userId, workspaceId, 'ADMIN');
    if (!cookie) return null;
    const [flow] = await this.db
      .select()
      .from(githubInstallStates)
      .where(
        and(
          eq(githubInstallStates.stateHash, hashToken(cookie)),
          eq(githubInstallStates.userId, userId),
          eq(githubInstallStates.workspaceId, workspaceId),
          eq(githubInstallStates.mode, 'choose'),
        ),
      );
    return flow && flow.expiresAt.getTime() > Date.now() ? flow : null;
  }

  async available(
    userId: string,
    workspaceId: string,
    cookie?: string,
  ): Promise<AvailableGithubInstallation[]> {
    const flow = await this.choiceFlow(userId, workspaceId, cookie);
    return (flow?.verifiedInstallations ?? []).map((i) => ({
      githubInstallationId: i.id,
      accountLogin: i.accountLogin,
      accountType: i.accountType,
    }));
  }

  async connectExisting(
    userId: string,
    workspaceId: string,
    githubInstallationId: number,
    cookie?: string,
  ) {
    const flow = await this.choiceFlow(userId, workspaceId, cookie);
    const info = flow?.verifiedInstallations?.find((i) => i.id === githubInstallationId);
    if (!flow || !info) throw notAuthorized();
    // Consume once before binding; a replay cannot reuse this proof for another connection.
    const consumed = await this.db
      .delete(githubInstallStates)
      .where(eq(githubInstallStates.id, flow.id))
      .returning();
    if (!consumed.length) throw stateInvalid();
    await this.bind(
      flow,
      { ...info, suspendedAt: info.suspendedAt ? new Date(info.suspendedAt) : null },
      info.repositoryIds,
    );
  }

  private async bind(flow: InstallStateRow, info: GithubInstallationInfo, repositoryIds: number[]) {
    await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    const [actor] = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, flow.userId));
    await this.db.transaction(async (tx) => {
      const [installation] = await tx
        .insert(githubInstallations)
        .values({
          githubInstallationId: info.id,
          accountLogin: info.accountLogin,
          accountType: info.accountType,
          status: info.suspendedAt ? 'SUSPENDED' : 'ACTIVE',
          suspendedAt: info.suspendedAt,
          installedBy: flow.userId,
        })
        .onConflictDoUpdate({
          target: githubInstallations.githubInstallationId,
          set: {
            accountLogin: info.accountLogin,
            accountType: info.accountType,
            status: info.suspendedAt ? 'SUSPENDED' : 'ACTIVE',
            suspendedAt: info.suspendedAt,
          },
        })
        .returning();
      const [connection] = await tx
        .insert(githubWorkspaceConnections)
        .values({
          installationId: installation!.id,
          workspaceId: flow.workspaceId,
          connectedBy: flow.userId,
          authorizedRepositoryIds: repositoryIds,
        })
        .onConflictDoNothing()
        .returning();
      if (!connection) {
        await tx
          .update(githubWorkspaceConnections)
          .set({ authorizedRepositoryIds: repositoryIds, connectedBy: flow.userId })
          .where(
            and(
              eq(githubWorkspaceConnections.installationId, installation!.id),
              eq(githubWorkspaceConnections.workspaceId, flow.workspaceId),
            ),
          );
        return;
      }
      await this.events.activity(tx, {
        workspaceId: flow.workspaceId,
        projectId: null,
        actor: actor ?? null,
        entity: { type: 'github_installation', id: connection.id },
        action: 'github_installation.installed',
        metadata: { account: info.accountLogin },
      });
    });
  }

  async list(userId: string, workspaceId: string): Promise<GithubConnectionList> {
    await this.access.require(userId, workspaceId, 'ADMIN');
    const rows = await this.db
      .select({
        installation: githubInstallations,
        connection: githubWorkspaceConnections,
        installer: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
      })
      .from(githubWorkspaceConnections)
      .innerJoin(
        githubInstallations,
        eq(githubInstallations.id, githubWorkspaceConnections.installationId),
      )
      .leftJoin(users, eq(users.id, githubWorkspaceConnections.connectedBy))
      .where(eq(githubWorkspaceConnections.workspaceId, workspaceId))
      .orderBy(asc(githubInstallations.accountLogin));
    const connections = rows.map((r) => toConnection(r.installation, r.connection, r.installer));
    return {
      appConfigured: this.config.githubApp !== null,
      connections,
      installations: connections,
    };
  }

  /**
   * Repositories the installation can access, read live from GitHub (Admin/Owner only: this
   * reveals repositories that are not connected to any project). Also refreshes the stored
   * names of repositories DevTrack already knows, since GitHub names can change (§11.3).
   */
  async listRepositories(userId: string, connectionId: string): Promise<AvailableRepository[]> {
    const repos = await this.repositoryAccess(userId, connectionId);
    return repos.filter((r) => r.allowed).map(({ allowed: _allowed, ...r }) => r);
  }

  async repositoryAccess(userId: string, connectionId: string): Promise<GithubRepositoryAccess[]> {
    const installation = await this.requireForAdmin(userId, connectionId);
    const repos = await this.call(installation, () =>
      this.client.listInstallationRepositories(installation.githubInstallationId),
    );
    const rule = await this.repoAccess.grantable(this.db, installation.ref, userId);
    const allowed = new Set(rule.granted);
    const visible = new Set(rule.grantable);
    const connected = await this.db
      .select({ repoId: githubRepositories.githubRepositoryId, projectId: projects.id })
      .from(projectRepositories)
      .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
      .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
      .where(
        and(
          eq(projects.workspaceId, installation.workspaceId),
          eq(githubRepositories.installationId, installation.id),
        ),
      );
    const stored = await this.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.installationId, installation.id));
    const storedById = new Map(stored.map((r) => [r.githubRepositoryId, r]));
    const result: GithubRepositoryAccess[] = [];
    for (const repo of repos.filter((r) => visible.has(r.id))) {
      const known = storedById.get(repo.id);
      if (
        known &&
        (known.fullName !== repo.fullName ||
          known.ownerLogin !== repo.ownerLogin ||
          known.defaultBranch !== repo.defaultBranch ||
          known.visibility !== repo.visibility)
      )
        await this.db
          .update(githubRepositories)
          .set({
            fullName: repo.fullName,
            ownerLogin: repo.ownerLogin,
            defaultBranch: repo.defaultBranch,
            visibility: repo.visibility,
          })
          .where(
            and(
              eq(githubRepositories.installationId, installation.id),
              eq(githubRepositories.githubRepositoryId, repo.id),
            ),
          );
      result.push({
        githubRepositoryId: repo.id,
        fullName: repo.fullName,
        ownerLogin: repo.ownerLogin,
        defaultBranch: repo.defaultBranch,
        visibility: repo.visibility,
        allowed: allowed.has(repo.id),
        connectedProjectIds: connected.filter((r) => r.repoId === repo.id).map((r) => r.projectId),
      });
    }
    return result.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async updateRepositoryAccess(userId: string, connectionId: string, ids: number[]) {
    const connection = await this.requireForAdmin(userId, connectionId);
    // Only repositories GitHub still lets the installation read, within what the user may grant.
    const available = await this.repositoryAccess(userId, connectionId);
    const visible = new Set(available.map((r) => r.githubRepositoryId));
    if (ids.some((id) => !visible.has(id)))
      throw AppException.forbidden(
        'Reauthorize GitHub to grant access to additional repositories.',
      );
    const actor = await this.actor(userId);
    await this.db.transaction((tx) => this.repoAccess.setGrants(tx, connection.ref, ids, actor));
  }

  async disconnectWorkspace(userId: string, connectionId: string) {
    const connection = await this.requireForAdmin(userId, connectionId);
    const actor = await this.actor(userId);
    await this.db.transaction((tx) =>
      this.repoAccess.disconnectWorkspace(tx, connection.ref, actor),
    );
  }

  private async actor(userId: string) {
    const [actor] = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, userId));
    if (!actor) throw AppException.unauthenticated();
    return actor;
  }

  async requireForAdmin(userId: string, connectionId: string): Promise<WorkspaceConnection> {
    const [row] = isUuid(connectionId)
      ? await this.db
          .select({ installation: githubInstallations, connection: githubWorkspaceConnections })
          .from(githubWorkspaceConnections)
          .innerJoin(
            githubInstallations,
            eq(githubInstallations.id, githubWorkspaceConnections.installationId),
          )
          .where(eq(githubWorkspaceConnections.id, connectionId))
      : [];
    if (!row) throw installationNotFound();
    await this.access.require(userId, row.connection.workspaceId, 'ADMIN');
    return {
      ...row.installation,
      connectionId: row.connection.id,
      workspaceId: row.connection.workspaceId,
      ref: {
        id: row.connection.id,
        workspaceId: row.connection.workspaceId,
        installationId: row.installation.id,
      },
    };
  }

  /**
   * Runs a GitHub call for an ACTIVE installation. If GitHub reports it uninstalled or
   * suspended, records that status and fails with 409.
   */
  async call<T>(installation: InstallationRow, fn: () => Promise<T>): Promise<T> {
    if (installation.status !== 'ACTIVE') throw installationUnavailable();
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GithubInstallationUnavailableError) {
        this.logger.warn(
          `GitHub installation ${installation.githubInstallationId} is ${err.status.toLowerCase()}`,
        );
        await this.db
          .update(githubInstallations)
          .set({
            status: err.status,
            suspendedAt: err.status === 'SUSPENDED' ? new Date() : installation.suspendedAt,
          })
          .where(eq(githubInstallations.id, installation.id));
        throw installationUnavailable();
      }
      throw err;
    }
  }
}

function toConnection(
  row: InstallationRow,
  connection: typeof githubWorkspaceConnections.$inferSelect,
  installer: { id: string; username: string; avatarUrl: string | null } | null,
): GithubConnection {
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    githubInstallationId: row.githubInstallationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    status: row.status,
    installedBy: installer,
    installedAt: connection.connectedAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
  };
}

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  githubInstallations,
  githubInstallStates,
  githubRepositories,
  inArray,
  lt,
  projectRepositories,
  users,
  type Database,
} from '@devtrack/database';
import {
  ErrorCode,
  type AvailableRepository,
  type GithubInstallation,
  type GithubInstallationList,
} from '@devtrack/types';
import { generateToken, hashToken, safeEqual } from '../../common/crypto/tokens';
import { AppException } from '../../common/errors/app.exception';
import { isUuid } from '../../common/pipes/uuid-param.pipe';
import { GITHUB_INSTALL_STATE_TTL_MS } from '../../auth/auth-cookies.service';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import { isUniqueViolation } from '../../database/pg-errors';
import { EventRecorder } from '../../events/event-recorder.service';
import { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import { GithubAppClient, GithubInstallationUnavailableError } from '../github-app.client';

export type InstallationRow = typeof githubInstallations.$inferSelect;
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
  ) {}

  /** Returns GitHub's installation URL and the raw state for the browser-binding cookie. */
  async begin(userId: string, workspaceId: string): Promise<{ installUrl: string; state: string }> {
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
      stateHash: hashToken(state),
      userId,
      workspaceId,
      expiresAt: new Date(Date.now() + GITHUB_INSTALL_STATE_TTL_MS),
    });
    const url = new URL(`https://github.com/apps/${app.slug}/installations/new`);
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
    if (!row || row.expiresAt.getTime() <= Date.now()) throw stateInvalid();
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
    const { workspace } = await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    if (params.setupAction === 'request') return 'requested';

    const githubInstallationId =
      params.installationId && /^\d{1,15}$/.test(params.installationId)
        ? Number(params.installationId)
        : null;
    if (!githubInstallationId || !params.code) throw notAuthorized();

    const userToken = await this.client.exchangeInstallCode(params.code);
    if (!userToken) throw notAuthorized();
    let info;
    try {
      info = await this.client.findUserInstallation(userToken, githubInstallationId);
    } finally {
      await this.client.revokeUserToken(userToken);
    }
    if (!info) throw notAuthorized();

    const [actor] = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, flow.userId));
    const values = {
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      status: info.suspendedAt ? ('SUSPENDED' as const) : ('ACTIVE' as const),
      suspendedAt: info.suspendedAt,
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const [existing] = await this.db
        .select()
        .from(githubInstallations)
        .where(eq(githubInstallations.githubInstallationId, githubInstallationId));
      if (existing) {
        if (existing.workspaceId !== workspace.id) throw inUse();
        // Re-running the flow (e.g. after changing repository access on GitHub) refreshes it.
        await this.db
          .update(githubInstallations)
          .set(values)
          .where(eq(githubInstallations.id, existing.id));
        return 'installed';
      }
      try {
        await this.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(githubInstallations)
            .values({
              ...values,
              workspaceId: workspace.id,
              githubInstallationId,
              installedBy: flow.userId,
            })
            .returning();
          await this.events.activity(tx, {
            workspaceId: workspace.id,
            projectId: null,
            actor: actor ?? null,
            entity: { type: 'github_installation', id: created!.id },
            action: 'github_installation.installed',
            metadata: { account: info.accountLogin },
          });
        });
        return 'installed';
      } catch (err) {
        // A concurrent callback for the same installation won: re-check who owns it.
        if (attempt === 0 && isUniqueViolation(err, 'github_installations_github_id_unique')) {
          continue;
        }
        throw err;
      }
    }
    throw new Error('unreachable');
  }

  async list(userId: string, workspaceId: string): Promise<GithubInstallationList> {
    await this.access.require(userId, workspaceId, 'ADMIN');
    const rows = await this.db
      .select({
        installation: githubInstallations,
        installer: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
      })
      .from(githubInstallations)
      .leftJoin(users, eq(users.id, githubInstallations.installedBy))
      .where(eq(githubInstallations.workspaceId, workspaceId))
      .orderBy(asc(githubInstallations.accountLogin));
    return {
      appConfigured: this.config.githubApp !== null,
      installations: rows.map((r) => toInstallation(r.installation, r.installer)),
    };
  }

  /**
   * Repositories the installation can access, read live from GitHub (Admin/Owner only: this
   * reveals repositories that are not connected to any project). Also refreshes the stored
   * names of repositories DevTrack already knows, since GitHub names can change (§11.3).
   */
  async listRepositories(userId: string, installationId: string): Promise<AvailableRepository[]> {
    const installation = await this.requireForAdmin(userId, installationId);
    const repos = await this.call(installation, () =>
      this.client.listInstallationRepositories(installation.githubInstallationId),
    );

    const known = await this.db
      .select({ repo: githubRepositories, projectId: projectRepositories.projectId })
      .from(githubRepositories)
      .leftJoin(projectRepositories, eq(projectRepositories.repositoryId, githubRepositories.id))
      .where(
        and(
          eq(githubRepositories.installationId, installation.id),
          inArray(
            githubRepositories.githubRepositoryId,
            repos.length ? repos.map((r) => r.id) : [-1],
          ),
        ),
      );
    const projectsByRepo = new Map<number, string[]>();
    const stored = new Map<number, typeof githubRepositories.$inferSelect>();
    for (const row of known) {
      stored.set(row.repo.githubRepositoryId, row.repo);
      const list = projectsByRepo.get(row.repo.githubRepositoryId) ?? [];
      if (row.projectId) list.push(row.projectId);
      projectsByRepo.set(row.repo.githubRepositoryId, list);
    }

    for (const repo of repos) {
      const row = stored.get(repo.id);
      if (
        row &&
        (row.fullName !== repo.fullName ||
          row.ownerLogin !== repo.ownerLogin ||
          row.defaultBranch !== repo.defaultBranch ||
          row.visibility !== repo.visibility)
      ) {
        await this.db
          .update(githubRepositories)
          .set({
            fullName: repo.fullName,
            ownerLogin: repo.ownerLogin,
            defaultBranch: repo.defaultBranch,
            visibility: repo.visibility,
          })
          .where(eq(githubRepositories.id, row.id));
      }
    }

    return repos
      .map((r) => ({
        githubRepositoryId: r.id,
        fullName: r.fullName,
        ownerLogin: r.ownerLogin,
        defaultBranch: r.defaultBranch,
        visibility: r.visibility,
        connectedProjectIds: projectsByRepo.get(r.id) ?? [],
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /** Loads an installation for an Admin/Owner of its workspace; anyone else gets 404. */
  async requireForAdmin(userId: string, installationId: string): Promise<InstallationRow> {
    const [installation] = isUuid(installationId)
      ? await this.db
          .select()
          .from(githubInstallations)
          .where(eq(githubInstallations.id, installationId))
      : [];
    if (!installation) throw installationNotFound();
    try {
      await this.access.require(userId, installation.workspaceId, 'ADMIN');
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw installationNotFound();
      }
      throw err;
    }
    return installation;
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

const inUse = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.GITHUB_INSTALLATION_IN_USE,
    'This GitHub installation is already connected to another DevTrack workspace.',
  );

function toInstallation(
  row: InstallationRow,
  installer: { id: string; username: string; avatarUrl: string | null } | null,
): GithubInstallation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    githubInstallationId: row.githubInstallationId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    status: row.status,
    installedBy: installer,
    installedAt: row.installedAt.toISOString(),
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
  };
}

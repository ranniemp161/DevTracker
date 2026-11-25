import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  githubInstallations,
  githubRepositories,
  githubWorkspaceConnections,
  projects,
  projectRepositories,
  users,
  type Database,
} from '@devtrack/database';
import {
  ErrorCode,
  type AvailableRepository,
  type GithubRepositoryAccess,
  type GithubConnection,
  type GithubConnectionList,
} from '@devtrack/types';
import { AppException } from '../../common/errors/app.exception';
import { isUuid } from '../../common/pipes/uuid-param.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import { RepositoryAccess, type ConnectionRef } from '../access/repository-access.service';
import type { VerifiedInstallation } from '../authorization/github-authorization.service';
import { GithubAppClient, GithubInstallationUnavailableError } from '../github-app.client';

export type InstallationRow = typeof githubInstallations.$inferSelect;
/** A workspace connection with its installation's row (`id` is the installation's). */
export type WorkspaceConnection = InstallationRow & {
  connectionId: string;
  workspaceId: string;
  /** The connection as RepositoryAccess takes it. */
  ref: ConnectionRef;
};
export const installationUnavailable = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.GITHUB_INSTALLATION_UNAVAILABLE,
    'This GitHub installation is suspended or was removed on GitHub.',
  );

const installationNotFound = () => AppException.notFound('GitHub installation not found.');

/**
 * A workspace's GitHub connections (architecture §11.2, decision records 0005 and 0010):
 * listing them, the live repository access list from GitHub, and the wrapper that records an
 * installation GitHub reports suspended or removed. Signing in with GitHub is
 * GithubAuthorization's job; access rules and writes are RepositoryAccess's.
 */
@Injectable()
export class GithubInstallationsService {
  private readonly logger = new Logger(GithubInstallationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: WorkspaceAccessService,
    private readonly client: GithubAppClient,
    private readonly repoAccess: RepositoryAccess,
  ) {}

  /** Saves the workspace's connection once GitHub verified the user (GithubAuthorization). */
  async connect(proof: VerifiedInstallation): Promise<void> {
    const [actor] = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, proof.userId));
    await this.db.transaction((tx) => this.repoAccess.connectWorkspace(tx, proof, actor ?? null));
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

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  githubInstallations,
  githubRepositories,
  githubWorkspaceConnections,
  projectRepositories,
  projects,
  users,
  type Database,
} from '@devtrack/database';
import { ErrorCode, type ConnectedRepository } from '@devtrack/types';
import type { ConnectRepositoryInput } from '@devtrack/validators';
import { AppException } from '../../common/errors/app.exception';
import { isUuid } from '../../common/pipes/uuid-param.pipe';
import { DATABASE } from '../../database/database.module';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';
import { ProjectAccessService } from '../../projects/project-access.service';
import { RepositoryAccess } from '../access/repository-access.service';
import { GithubAppClient } from '../github-app.client';
import { GithubInstallationsService } from '../installations/installations.service';
import { GithubEventProcessor } from '../webhooks/github-event-processor.service';

const notConnected = () =>
  AppException.notFound('This repository is not connected to the project.');

/**
 * Project ↔ repository connections (architecture §7.5, §11.3; decision record 0005).
 * - Anyone with project access can see connected repositories.
 * - Workspace Admins/Owner connect and disconnect them (archived projects are read-only).
 * - Only repositories GitHub confirms the installation can access can be connected, and only
 *   through an ACTIVE, independently authorized connection of the project's own workspace.
 * - A repository may be connected to projects in separately authorized workspaces.
 * - Disconnecting keeps the repository row (and, from M6, its history).
 */
@Injectable()
export class ProjectRepositoriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
    private readonly installations: GithubInstallationsService,
    private readonly client: GithubAppClient,
    private readonly events: EventRecorder,
    private readonly processor: GithubEventProcessor,
    private readonly repositoryAccess: RepositoryAccess,
  ) {}

  private readonly logger = new Logger(ProjectRepositoriesService.name);

  async list(userId: string, projectId: string): Promise<ConnectedRepository[]> {
    const { project } = await this.access.require(userId, projectId);
    return this.query(project.id);
  }

  async connect(
    actor: Actor,
    projectId: string,
    input: ConnectRepositoryInput,
  ): Promise<ConnectedRepository> {
    const { project } = await this.access.require(actor.id, projectId, { manage: true });

    const installation = await this.installations.requireForAdmin(actor.id, input.connectionId);
    const connection = {
      id: installation.connectionId,
      workspaceId: installation.workspaceId,
      installationId: installation.id,
    };
    await this.repositoryAccess.assertCanConnect(
      this.db,
      project,
      connection,
      input.githubRepositoryId,
    );

    const repo = await this.installations.call(installation, () =>
      this.client.getRepository(installation.githubInstallationId, input.githubRepositoryId),
    );
    if (!repo) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.GITHUB_REPOSITORY_NOT_ACCESSIBLE,
        'The GitHub App cannot access this repository. Check the installation’s repository access on GitHub.',
      );
    }

    const repositoryId = await this.db.transaction((tx) =>
      this.repositoryAccess.connectProject(tx, project, connection, repo, actor),
    );
    // Import existing pull requests. Best effort: the connection stands even if GitHub is
    // unavailable right now, and "Sync pull requests" can be used later.
    await this.importPullRequests(installation, repo.id).catch((err: unknown) =>
      this.logger.warn(
        `Pull request import for ${repo.fullName} failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    const connected = await this.query(project.id, repositoryId);
    return connected[0]!;
  }

  /**
   * "Sync pull requests" (M7 fix): re-imports the repository's most recently updated pull
   * requests. Admins/Owner, like connecting. History only: no activity or notifications.
   */
  async syncPullRequests(
    userId: string,
    projectId: string,
    repositoryId: string,
  ): Promise<{ imported: number }> {
    const { project } = await this.access.require(userId, projectId, { manage: true });
    if (!isUuid(repositoryId)) throw notConnected();
    const [row] = await this.db
      .select({ repo: githubRepositories, installation: githubInstallations })
      .from(projectRepositories)
      .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
      .innerJoin(githubInstallations, eq(githubInstallations.id, githubRepositories.installationId))
      .where(
        and(
          eq(projectRepositories.projectId, project.id),
          eq(projectRepositories.repositoryId, repositoryId),
        ),
      );
    if (!row) throw notConnected();
    return {
      imported: await this.importPullRequests(row.installation, row.repo.githubRepositoryId),
    };
  }

  private async importPullRequests(
    installation: typeof githubInstallations.$inferSelect,
    githubRepositoryId: number,
  ): Promise<number> {
    const pullRequests = await this.installations.call(installation, () =>
      this.client.listPullRequests(installation.githubInstallationId, githubRepositoryId),
    );
    if (pullRequests.length === 0) return 0;
    return this.db.transaction((tx) =>
      this.processor.importPullRequests(
        tx,
        installation.githubInstallationId,
        githubRepositoryId,
        pullRequests,
      ),
    );
  }

  async disconnect(actor: Actor, projectId: string, repositoryId: string): Promise<void> {
    const { project } = await this.access.require(actor.id, projectId, { manage: true });
    if (!isUuid(repositoryId)) throw notConnected();

    await this.db.transaction((tx) =>
      this.repositoryAccess.disconnectProject(tx, project, repositoryId, actor),
    );
  }

  private async query(projectId: string, repositoryId?: string): Promise<ConnectedRepository[]> {
    const rows = await this.db
      .select({
        repo: githubRepositories,
        installationStatus: githubInstallations.status,
        connectionId: githubWorkspaceConnections.id,
        connectedAt: projectRepositories.connectedAt,
        connectedBy: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
      })
      .from(projectRepositories)
      .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
      .innerJoin(githubInstallations, eq(githubInstallations.id, githubRepositories.installationId))
      .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
      .innerJoin(
        githubWorkspaceConnections,
        and(
          eq(githubWorkspaceConnections.installationId, githubInstallations.id),
          eq(githubWorkspaceConnections.workspaceId, projects.workspaceId),
        ),
      )
      .leftJoin(users, eq(users.id, projectRepositories.connectedBy))
      .where(
        and(
          eq(projectRepositories.projectId, projectId),
          repositoryId ? eq(projectRepositories.repositoryId, repositoryId) : undefined,
        ),
      )
      .orderBy(asc(githubRepositories.fullName));
    return rows.map((r) => ({
      id: r.repo.id,
      connectionId: r.connectionId,
      installationId: r.connectionId,
      installationStatus: r.installationStatus,
      githubRepositoryId: r.repo.githubRepositoryId,
      fullName: r.repo.fullName,
      ownerLogin: r.repo.ownerLogin,
      defaultBranch: r.repo.defaultBranch,
      visibility: r.repo.visibility,
      url: `https://github.com/${r.repo.fullName}`,
      connectedBy: r.connectedBy,
      connectedAt: r.connectedAt.toISOString(),
    }));
  }
}

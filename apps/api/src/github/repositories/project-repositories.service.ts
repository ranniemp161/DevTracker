import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  githubInstallations,
  githubRepositories,
  projectRepositories,
  sql,
  users,
  type Database,
} from '@devtrack/database';
import { ErrorCode, type ConnectedRepository } from '@devtrack/types';
import type { ConnectRepositoryInput } from '@devtrack/validators';
import { AppException } from '../../common/errors/app.exception';
import { isUuid } from '../../common/pipes/uuid-param.pipe';
import { DATABASE } from '../../database/database.module';
import { isUniqueViolation } from '../../database/pg-errors';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';
import { ProjectAccessService, type ProjectRow } from '../../projects/project-access.service';
import { GithubAppClient } from '../github-app.client';
import { GithubInstallationsService } from '../installations/installations.service';

const notConnected = () =>
  AppException.notFound('This repository is not connected to the project.');

/**
 * Project ↔ repository connections (architecture §7.5, §11.3; decision record 0005).
 * - Anyone with project access can see connected repositories.
 * - Workspace Admins/Owner connect and disconnect them (archived projects are read-only).
 * - Only repositories GitHub confirms the installation can access can be connected, and only
 *   through an ACTIVE installation of the project's own workspace.
 * - A repository may be connected to several projects of the same workspace.
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
  ) {}

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

    const [installation] = await this.db
      .select()
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.id, input.installationId),
          // Never connect through another workspace's installation.
          eq(githubInstallations.workspaceId, project.workspaceId),
        ),
      );
    if (!installation) throw AppException.notFound('GitHub installation not found.');

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

    let repositoryId!: string;
    try {
      await this.db.transaction(async (tx) => {
        const metadata = {
          fullName: repo.fullName,
          ownerLogin: repo.ownerLogin,
          defaultBranch: repo.defaultBranch,
          visibility: repo.visibility,
        };
        const [row] = await tx
          .insert(githubRepositories)
          .values({ installationId: installation.id, githubRepositoryId: repo.id, ...metadata })
          .onConflictDoUpdate({
            target: [githubRepositories.installationId, githubRepositories.githubRepositoryId],
            set: { ...metadata, disconnectedAt: null, updatedAt: sql`now()` },
          })
          .returning({ id: githubRepositories.id });
        repositoryId = row!.id;
        await tx
          .insert(projectRepositories)
          .values({ projectId: project.id, repositoryId, connectedBy: actor.id });
        await this.events.activity(tx, {
          ...projectScope(project),
          actor,
          action: 'project.repository_connected',
          metadata: { repository: { id: repositoryId, fullName: repo.fullName } },
          event: {
            type: 'project.repository_connected',
            payload: { repositoryId, githubRepositoryId: repo.id },
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'project_repositories_pk')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.REPOSITORY_ALREADY_CONNECTED,
          'This repository is already connected to the project.',
        );
      }
      throw err;
    }
    const connected = await this.query(project.id, repositoryId);
    return connected[0]!;
  }

  async disconnect(actor: Actor, projectId: string, repositoryId: string): Promise<void> {
    const { project } = await this.access.require(actor.id, projectId, { manage: true });
    if (!isUuid(repositoryId)) throw notConnected();

    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(projectRepositories)
        .where(
          and(
            eq(projectRepositories.projectId, project.id),
            eq(projectRepositories.repositoryId, repositoryId),
          ),
        )
        .returning();
      if (!removed) throw notConnected();

      const [repo] = await tx
        .select({ fullName: githubRepositories.fullName })
        .from(githubRepositories)
        .where(eq(githubRepositories.id, repositoryId));
      const [remaining] = await tx
        .select({ n: count() })
        .from(projectRepositories)
        .where(eq(projectRepositories.repositoryId, repositoryId));
      if (remaining!.n === 0) {
        await tx
          .update(githubRepositories)
          .set({ disconnectedAt: new Date() })
          .where(eq(githubRepositories.id, repositoryId));
      }
      await this.events.activity(tx, {
        ...projectScope(project),
        actor,
        action: 'project.repository_disconnected',
        metadata: { repository: { id: repositoryId, fullName: repo?.fullName ?? null } },
        event: { type: 'project.repository_disconnected', payload: { repositoryId } },
      });
    });
  }

  private async query(projectId: string, repositoryId?: string): Promise<ConnectedRepository[]> {
    const rows = await this.db
      .select({
        repo: githubRepositories,
        installationStatus: githubInstallations.status,
        connectedAt: projectRepositories.connectedAt,
        connectedBy: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
      })
      .from(projectRepositories)
      .innerJoin(githubRepositories, eq(githubRepositories.id, projectRepositories.repositoryId))
      .innerJoin(githubInstallations, eq(githubInstallations.id, githubRepositories.installationId))
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
      installationId: r.repo.installationId,
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

function projectScope(project: ProjectRow) {
  return {
    workspaceId: project.workspaceId,
    projectId: project.id,
    entity: { type: 'project' as const, id: project.id },
  };
}

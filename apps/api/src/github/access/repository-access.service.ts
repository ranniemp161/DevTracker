import { HttpStatus, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  githubInstallations,
  githubRepositories,
  githubWorkspaceConnections,
  githubWorkspaceRepositories,
  inArray,
  isNull,
  ne,
  projectRepositories,
  projects,
  sql,
  type Executor,
  type Transaction,
} from '@devtrack/database';
import { ErrorCode } from '@devtrack/types';
import { AppException } from '../../common/errors/app.exception';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';
import type { GithubRepo } from '../github-app.client';

/**
 * Why a project repository was removed without a person doing it. Stored in activity metadata,
 * so the values never change.
 */
export const DISCONNECT_REASONS = [
  /** The workspace removed the grant or disconnected its connection. */
  'workspace_access_removed',
  /** GitHub stopped letting the installation read the repository. */
  'access_removed',
  /** The app was uninstalled on GitHub. */
  'app_uninstalled',
] as const;
export type DisconnectReason = (typeof DISCONNECT_REASONS)[number];

export type InstallationRow = typeof githubInstallations.$inferSelect;
export type RepositoryRow = typeof githubRepositories.$inferSelect;

/** One workspace's connection to an installation, as the module needs it. */
export interface ConnectionRef {
  /** The connection ID. */
  id: string;
  workspaceId: string;
  /** DevTrack's installation UUID. */
  installationId: string;
}

/** The part of a project the access rules need. */
export interface ProjectRef {
  id: string;
  workspaceId: string;
}

const connectionNotFound = () => AppException.notFound('GitHub installation not found.');
const notGranted = () =>
  AppException.forbidden('Allow this repository in workspace GitHub settings first.');
const notLinked = () => AppException.notFound('This repository is not connected to the project.');

/** A project that receives a repository's GitHub events. */
export interface TargetProject {
  id: string;
  workspaceId: string;
  key: string;
  /** GitHub events this project posts to its chat (0014). */
  chatGithubEvents: string[];
}

/** A repository and the projects that receive its GitHub events. */
export interface Target {
  repo: RepositoryRow;
  projects: TargetProject[];
}

/**
 * Every rule and every write for connections, repository grants and project repositories
 * (#111, decision record 0010), including the activity and realtime events each change records.
 *
 * - Writes take the caller's transaction, and the module takes its own row locks.
 * - It never calls GitHub: callers verify with GitHub first and pass in what they verified.
 * - It never checks roles: callers check them first. Webhooks have no user.
 * - A repository is marked disconnected whenever its last project repository is removed, and
 *   the mark is cleared when it is linked to a project again.
 */
@Injectable()
export class RepositoryAccess {
  constructor(private readonly events: EventRecorder) {}

  /**
   * Which projects receive a GitHub event for this repository. A project is a target only when
   * the installation is ACTIVE, its workspace has a connection with a grant for the repository,
   * a project repository links them, and the project is not archived. Null when none is.
   */
  async targets(
    tx: Executor,
    githubInstallationId: number,
    githubRepositoryId: number,
  ): Promise<Target | null> {
    const [row] = await tx
      .select({ repo: githubRepositories })
      .from(githubRepositories)
      .innerJoin(githubInstallations, eq(githubInstallations.id, githubRepositories.installationId))
      .where(
        and(
          eq(githubInstallations.githubInstallationId, githubInstallationId),
          eq(githubInstallations.status, 'ACTIVE'),
          eq(githubRepositories.githubRepositoryId, githubRepositoryId),
          isNull(githubRepositories.disconnectedAt),
        ),
      );
    if (!row) return null;
    const connected = await tx
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        key: projects.key,
        chatGithubEvents: projects.chatGithubEvents,
      })
      .from(projectRepositories)
      .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
      .innerJoin(
        githubWorkspaceConnections,
        and(
          eq(githubWorkspaceConnections.installationId, row.repo.installationId),
          eq(githubWorkspaceConnections.workspaceId, projects.workspaceId),
        ),
      )
      .innerJoin(
        githubWorkspaceRepositories,
        and(
          eq(githubWorkspaceRepositories.connectionId, githubWorkspaceConnections.id),
          eq(githubWorkspaceRepositories.githubRepositoryId, row.repo.githubRepositoryId),
        ),
      )
      .where(
        and(eq(projectRepositories.repositoryId, row.repo.id), ne(projects.status, 'ARCHIVED')),
      );
    if (connected.length === 0) return null;
    return { repo: row.repo, projects: connected };
  }

  /**
   * Fails unless the project may be linked to this repository through this connection: the
   * connection belongs to the project's workspace and has a grant for the repository. Callers
   * may check early, before asking GitHub; `connectProject` checks again under the lock.
   */
  async assertCanConnect(
    tx: Executor,
    project: ProjectRef,
    connection: ConnectionRef,
    githubRepositoryId: number,
  ): Promise<void> {
    if (connection.workspaceId !== project.workspaceId) throw connectionNotFound();
    const [granted] = await tx
      .select()
      .from(githubWorkspaceRepositories)
      .where(
        and(
          eq(githubWorkspaceRepositories.connectionId, connection.id),
          eq(githubWorkspaceRepositories.githubRepositoryId, githubRepositoryId),
        ),
      );
    if (!granted) throw notGranted();
  }

  /**
   * Links a project to a repository the caller verified with GitHub. Requires the same
   * workspace and an existing grant, checked under the connection lock so a concurrent grant
   * removal can't slip between check and write. Returns the DevTrack repository ID.
   */
  async connectProject(
    tx: Transaction,
    project: ProjectRef,
    connection: ConnectionRef,
    repo: GithubRepo,
    actor: Actor,
  ): Promise<string> {
    if (connection.workspaceId !== project.workspaceId) throw connectionNotFound();
    const [locked] = await tx
      .select({ id: githubWorkspaceConnections.id })
      .from(githubWorkspaceConnections)
      .where(eq(githubWorkspaceConnections.id, connection.id))
      .for('update');
    if (!locked) throw AppException.notFound('GitHub connection not found.');
    await this.assertCanConnect(tx, project, connection, repo.id);

    const metadata = {
      fullName: repo.fullName,
      ownerLogin: repo.ownerLogin,
      defaultBranch: repo.defaultBranch,
      visibility: repo.visibility,
    };
    const [row] = await tx
      .insert(githubRepositories)
      .values({
        installationId: connection.installationId,
        githubRepositoryId: repo.id,
        ...metadata,
      })
      .onConflictDoUpdate({
        target: [githubRepositories.installationId, githubRepositories.githubRepositoryId],
        set: { ...metadata, disconnectedAt: null, updatedAt: sql`now()` },
      })
      .returning({ id: githubRepositories.id });
    const repositoryId = row!.id;
    const [linked] = await tx
      .insert(projectRepositories)
      .values({ projectId: project.id, repositoryId, connectedBy: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!linked)
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.REPOSITORY_ALREADY_CONNECTED,
        'This repository is already connected to the project.',
      );
    await this.events.activity(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actor,
      entity: { type: 'project', id: project.id },
      action: 'project.repository_connected',
      metadata: { repository: { id: repositoryId, fullName: repo.fullName } },
      event: {
        type: 'project.repository_connected',
        payload: { repositoryId, githubRepositoryId: repo.id },
      },
    });
    return repositoryId;
  }

  /** Unlinks a project from a repository. The repository and its history are kept. */
  async disconnectProject(
    tx: Transaction,
    project: ProjectRef,
    repositoryId: string,
    actor: Actor,
  ): Promise<void> {
    const [repo] = await tx
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.id, repositoryId));
    if (!repo) throw notLinked();
    // Serialize with grant changes and workspace disconnects of this workspace's connection.
    await tx
      .select({ id: githubWorkspaceConnections.id })
      .from(githubWorkspaceConnections)
      .where(
        and(
          eq(githubWorkspaceConnections.installationId, repo.installationId),
          eq(githubWorkspaceConnections.workspaceId, project.workspaceId),
        ),
      )
      .for('update');
    const [removed] = await tx
      .delete(projectRepositories)
      .where(
        and(
          eq(projectRepositories.projectId, project.id),
          eq(projectRepositories.repositoryId, repositoryId),
        ),
      )
      .returning();
    if (!removed) throw notLinked();
    await this.markDisconnectedIfUnlinked(tx, [repositoryId]);
    await this.recordRemoval(tx, project, repo, { actor });
  }

  /**
   * GitHub no longer lets DevTrack read these repositories (`'all'` when the app was
   * uninstalled): remove their grants and project repositories in every connected workspace.
   * Repository rows and their history are kept (§11.9). Returns how many stored repositories
   * were affected; 0 means DevTrack never connected any of them.
   */
  async revokeOnGitHub(
    tx: Transaction,
    installation: InstallationRow,
    githubRepositoryIds: number[] | 'all',
    reason: Extract<DisconnectReason, 'access_removed' | 'app_uninstalled'>,
  ): Promise<number> {
    if (githubRepositoryIds !== 'all' && githubRepositoryIds.length === 0) return 0;
    const connections = await this.lockConnections(tx, installation.id);
    const repos = await tx
      .select()
      .from(githubRepositories)
      .where(
        and(
          eq(githubRepositories.installationId, installation.id),
          githubRepositoryIds === 'all'
            ? undefined
            : inArray(githubRepositories.githubRepositoryId, githubRepositoryIds),
        ),
      );
    if (repos.length === 0) return 0;
    if (connections.length)
      await tx.delete(githubWorkspaceRepositories).where(
        and(
          inArray(
            githubWorkspaceRepositories.connectionId,
            connections.map((c) => c.id),
          ),
          inArray(
            githubWorkspaceRepositories.githubRepositoryId,
            repos.map((r) => r.githubRepositoryId),
          ),
        ),
      );
    for (const repo of repos) {
      const removed = await tx
        .delete(projectRepositories)
        .where(eq(projectRepositories.repositoryId, repo.id))
        .returning({ projectId: projectRepositories.projectId });
      const affected = removed.length
        ? await tx
            .select({ id: projects.id, workspaceId: projects.workspaceId })
            .from(projects)
            .where(
              inArray(
                projects.id,
                removed.map((r) => r.projectId),
              ),
            )
        : [];
      for (const project of affected)
        await this.recordRemoval(tx, project, repo, { actor: null, reason });
    }
    await this.markDisconnectedIfUnlinked(
      tx,
      repos.map((r) => r.id),
    );
    return repos.length;
  }

  /** Locks every workspace connection to an installation, in a stable order. */
  private lockConnections(tx: Transaction, installationId: string) {
    return tx
      .select({ id: githubWorkspaceConnections.id })
      .from(githubWorkspaceConnections)
      .where(eq(githubWorkspaceConnections.installationId, installationId))
      .orderBy(asc(githubWorkspaceConnections.id))
      .for('update');
  }

  /** Sets the disconnected mark on each repository no project repository links any more. */
  private async markDisconnectedIfUnlinked(tx: Transaction, repositoryIds: string[]) {
    const ids = [...new Set(repositoryIds)];
    if (ids.length === 0) return;
    const linked = await tx
      .selectDistinct({ id: projectRepositories.repositoryId })
      .from(projectRepositories)
      .where(inArray(projectRepositories.repositoryId, ids));
    const keep = new Set(linked.map((r) => r.id));
    const unlinked = ids.filter((id) => !keep.has(id));
    if (unlinked.length)
      await tx
        .update(githubRepositories)
        .set({ disconnectedAt: new Date() })
        .where(
          and(inArray(githubRepositories.id, unlinked), isNull(githubRepositories.disconnectedAt)),
        );
  }

  /** The activity and realtime event of one removed project repository. */
  private recordRemoval(
    tx: Transaction,
    project: { id: string; workspaceId: string },
    repo: { id: string; fullName: string | null },
    by: { actor: Actor | null; reason?: DisconnectReason },
  ) {
    return this.events.activity(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actor: by.actor,
      entity: { type: 'project', id: project.id },
      action: 'project.repository_disconnected',
      metadata: {
        repository: { id: repo.id, fullName: repo.fullName },
        ...(by.reason ? { reason: by.reason } : {}),
      },
      event: { type: 'project.repository_disconnected', payload: { repositoryId: repo.id } },
    });
  }
}

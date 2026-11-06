import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  githubPullRequests,
  githubRepositories,
  isNotNull,
  isNull,
  projectRepositories,
  sql,
  taskGithubLinks,
  users,
  type Database,
} from '@devtrack/database';
import { ErrorCode, type LinkedPullRequest, type PullRequest } from '@devtrack/types';
import type { ListPullRequestsQuery } from '@devtrack/validators';
import { AppException } from '../../common/errors/app.exception';
import { decodeCursor, encodeCursor, isTimeCursor, Paginated } from '../../common/http/paginated';
import { isUuid } from '../../common/pipes/uuid-param.pipe';
import { DATABASE } from '../../database/database.module';
import { isUniqueViolation } from '../../database/pg-errors';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';
import { ProjectAccessService } from '../../projects/project-access.service';
import { TaskAccessService } from '../../tasks/task-access.service';
import { stateOf } from '../webhooks/github-event-processor.service';

type PrRow = typeof githubPullRequests.$inferSelect;

const prNotFound = () => AppException.notFound('Pull request not found.');

export const toPullRequest = (pr: PrRow, repo: { id: string; fullName: string }): PullRequest => ({
  id: pr.id,
  repository: { id: repo.id, fullName: repo.fullName },
  number: pr.number,
  title: pr.title,
  url: pr.url,
  authorLogin: pr.authorLogin,
  headBranch: pr.headBranch,
  baseBranch: pr.baseBranch,
  state: stateOf(pr),
  isDraft: pr.isDraft,
  openedAt: pr.openedAt.toISOString(),
  mergedAt: pr.mergedAt?.toISOString() ?? null,
  closedAt: pr.closedAt?.toISOString() ?? null,
});

/**
 * Pull requests and task links (architecture §9, §11.10, decision record 0006).
 * - Anyone with project access sees a connected repository's pull requests and a task's links.
 * - Anyone who can edit the task (project access, project not archived) links and unlinks.
 * - A pull request can only be linked to a task whose project the repository is connected to.
 * - Linking never changes task status.
 */
@Injectable()
export class PullRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectAccess: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly events: EventRecorder,
  ) {}

  async listForRepository(
    userId: string,
    repositoryId: string,
    query: ListPullRequestsQuery,
  ): Promise<Paginated<PullRequest>> {
    const repo = await this.requireRepository(userId, repositoryId);
    const before = query.cursor ? decodeCursor(query.cursor, isTimeCursor) : null;
    const rows = await this.db
      .select()
      .from(githubPullRequests)
      .where(
        and(
          eq(githubPullRequests.repositoryId, repo.id),
          query.state === 'open' ? eq(githubPullRequests.state, 'open') : undefined,
          query.state === 'closed'
            ? and(eq(githubPullRequests.state, 'closed'), isNull(githubPullRequests.mergedAt))
            : undefined,
          query.state === 'merged' ? isNotNull(githubPullRequests.mergedAt) : undefined,
          before
            ? sql`(${githubPullRequests.openedAt}, ${githubPullRequests.id}) < (${before.t}::timestamptz, ${before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(githubPullRequests.openedAt), desc(githubPullRequests.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ t: last.openedAt.toISOString(), id: last.id })
        : null;
    return new Paginated(
      page.map((pr) => toPullRequest(pr, repo)),
      nextCursor,
    );
  }

  async listForTask(userId: string, taskId: string): Promise<LinkedPullRequest[]> {
    const { task } = await this.taskAccess.require(userId, taskId);
    const rows = await this.db
      .select({
        pr: githubPullRequests,
        repo: { id: githubRepositories.id, fullName: githubRepositories.fullName },
        link: taskGithubLinks,
        linkedBy: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
      })
      .from(taskGithubLinks)
      .innerJoin(githubPullRequests, eq(githubPullRequests.id, taskGithubLinks.pullRequestId))
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubPullRequests.repositoryId))
      .leftJoin(users, eq(users.id, taskGithubLinks.linkedBy))
      .where(eq(taskGithubLinks.taskId, task.id))
      .orderBy(desc(githubPullRequests.openedAt), desc(githubPullRequests.id));
    return rows.map((r) => ({
      ...toPullRequest(r.pr, r.repo),
      link: {
        source: r.link.source,
        linkedBy: r.linkedBy,
        linkedAt: r.link.createdAt.toISOString(),
      },
    }));
  }

  async link(actor: Actor, taskId: string, pullRequestId: string): Promise<LinkedPullRequest> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    // The repository must be connected to the task's own project (never another workspace).
    const [row] = await this.db
      .select({
        pr: githubPullRequests,
        repo: { id: githubRepositories.id, fullName: githubRepositories.fullName },
      })
      .from(githubPullRequests)
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubPullRequests.repositoryId))
      .innerJoin(
        projectRepositories,
        and(
          eq(projectRepositories.repositoryId, githubRepositories.id),
          eq(projectRepositories.projectId, task.projectId),
        ),
      )
      .where(eq(githubPullRequests.id, pullRequestId));
    if (!row) throw prNotFound();

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .insert(taskGithubLinks)
          .values({ taskId: task.id, pullRequestId, source: 'MANUAL', linkedBy: actor.id });
        await this.events.activity(tx, {
          workspaceId: access.project.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          actor,
          entity: { type: 'pull_request', id: pullRequestId },
          action: 'pull_request.linked',
          metadata: prMetadata(row.pr, row.repo),
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'task_github_links_pk')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PULL_REQUEST_ALREADY_LINKED,
          'This pull request is already linked to the task.',
        );
      }
      throw err;
    }
    const linked = await this.listForTask(actor.id, task.id);
    return linked.find((p) => p.id === pullRequestId)!;
  }

  async unlink(actor: Actor, taskId: string, pullRequestId: string): Promise<void> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    if (!isUuid(pullRequestId)) throw prNotFound();
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(taskGithubLinks)
        .where(
          and(
            eq(taskGithubLinks.taskId, task.id),
            eq(taskGithubLinks.pullRequestId, pullRequestId),
          ),
        )
        .returning();
      if (!removed) throw AppException.notFound('This pull request is not linked to the task.');
      const [row] = await tx
        .select({
          pr: githubPullRequests,
          repo: { id: githubRepositories.id, fullName: githubRepositories.fullName },
        })
        .from(githubPullRequests)
        .innerJoin(githubRepositories, eq(githubRepositories.id, githubPullRequests.repositoryId))
        .where(eq(githubPullRequests.id, pullRequestId));
      await this.events.activity(tx, {
        workspaceId: access.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actor,
        entity: { type: 'pull_request', id: pullRequestId },
        action: 'pull_request.unlinked',
        metadata: row ? prMetadata(row.pr, row.repo) : {},
      });
    });
  }

  /**
   * A repository is visible to anyone who can access a project it is currently connected to.
   * Everyone else gets 404.
   */
  private async requireRepository(userId: string, repositoryId: string) {
    const notFound = () => AppException.notFound('Repository not found.');
    if (!isUuid(repositoryId)) throw notFound();
    const rows = await this.db
      .select({
        id: githubRepositories.id,
        fullName: githubRepositories.fullName,
        projectId: projectRepositories.projectId,
      })
      .from(githubRepositories)
      .innerJoin(projectRepositories, eq(projectRepositories.repositoryId, githubRepositories.id))
      .where(eq(githubRepositories.id, repositoryId));
    for (const row of rows) {
      try {
        await this.projectAccess.require(userId, row.projectId);
        return { id: row.id, fullName: row.fullName };
      } catch (err) {
        if (!(err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND)) throw err;
      }
    }
    throw notFound();
  }
}

function prMetadata(pr: PrRow, repo: { fullName: string }) {
  return {
    repository: repo.fullName,
    pullRequest: { id: pr.id, number: pr.number, title: pr.title, url: pr.url },
  };
}

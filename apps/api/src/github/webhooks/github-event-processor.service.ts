import { Injectable } from '@nestjs/common';
import {
  accounts,
  and,
  eq,
  githubCommits,
  githubInstallations,
  githubPullRequests,
  githubRepositories,
  githubReviews,
  inArray,
  isNull,
  ne,
  projectRepositories,
  projects,
  sql,
  taskAssignees,
  taskGithubLinks,
  tasks,
  users,
  workspaceMembers,
  type Transaction,
} from '@devtrack/database';
import type { NotificationType } from '@devtrack/types';
import { extractTaskKeys } from '@devtrack/validators';
import type { z } from 'zod';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';
import { ProjectAccessService } from '../../projects/project-access.service';
import {
  installationEventSchema,
  installationRepositoriesEventSchema,
  pullRequestEventSchema,
  pullRequestReviewEventSchema,
  pushEventSchema,
  releaseEventSchema,
  type PullRequestPayload,
  senderSchema,
} from './payloads';

export interface ProcessResult {
  status: 'PROCESSED' | 'IGNORED';
  /** Why a delivery was ignored (stored; never contains payload data). */
  reason?: string;
}

type RepoRow = typeof githubRepositories.$inferSelect;
type PrRow = typeof githubPullRequests.$inferSelect;
interface TargetProject {
  id: string;
  workspaceId: string;
  key: string;
}
/** A connected repository and the (non-archived) projects that receive its activity. */
interface Target {
  repo: RepoRow;
  workspaceId: string;
  projects: TargetProject[];
}

const ignored = (reason: string): ProcessResult => ({ status: 'IGNORED', reason });
const PROCESSED: ProcessResult = { status: 'PROCESSED' };

/** Activity shows at most this many commits per push. */
const COMMITS_IN_ACTIVITY = 5;
const headline = (message: string, max = 120) => {
  const first = message.split('\n', 1)[0]!.trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};
const date = (v: string | null | undefined) => (v ? new Date(v) : null);

/**
 * Applies one GitHub event inside the delivery's transaction (architecture §11.7–§11.10,
 * decision record 0006). Everything is idempotent: entities are upserted by GitHub IDs, and
 * the caller marks the delivery processed in the same transaction, so a retried delivery never
 * duplicates activity, links or notifications.
 *
 * GitHub events never change task status (§7.5).
 */
@Injectable()
export class GithubEventProcessor {
  constructor(
    private readonly events: EventRecorder,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async handle(tx: Transaction, eventType: string, payload: unknown): Promise<ProcessResult> {
    switch (eventType) {
      case 'push':
        return this.parse(pushEventSchema, payload, (p) => this.push(tx, p));
      case 'pull_request':
        return this.parse(pullRequestEventSchema, payload, (p) => this.pullRequest(tx, p));
      case 'pull_request_review':
        return this.parse(pullRequestReviewEventSchema, payload, (p) => this.review(tx, p));
      case 'release':
        return this.parse(releaseEventSchema, payload, (p) => this.release(tx, p));
      case 'installation':
        return this.parse(installationEventSchema, payload, (p) => this.installation(tx, p));
      case 'installation_repositories':
        return this.parse(installationRepositoriesEventSchema, payload, (p) =>
          this.installationRepositories(tx, p),
        );
      default:
        return ignored(`event ${eventType} is not handled`);
    }
  }

  private async parse<S extends z.ZodType>(
    schema: S,
    payload: unknown,
    fn: (parsed: z.infer<S>) => Promise<ProcessResult>,
  ): Promise<ProcessResult> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return ignored('payload does not match the expected shape');
    return fn(parsed.data);
  }

  // ---------------------------------------------------------------- push

  private async push(tx: Transaction, p: z.infer<typeof pushEventSchema>): Promise<ProcessResult> {
    if (!p.ref.startsWith('refs/heads/')) return ignored('not a branch push');
    if (p.deleted) return ignored('branch deleted');
    const target = await this.target(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');
    if (p.commits.length === 0) return ignored('no commits');

    const branch = p.ref.slice('refs/heads/'.length);
    const inserted = await tx
      .insert(githubCommits)
      .values(
        p.commits.map((c) => ({
          repositoryId: target.repo.id,
          sha: c.id,
          message: c.message.slice(0, 2000),
          authorLogin: c.author?.username ?? null,
          authorName: c.author?.name?.slice(0, 200) ?? null,
          url: c.url,
          branch,
          committedAt: new Date(c.timestamp),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: githubCommits.id, sha: githubCommits.sha });
    // Commits already seen (e.g. a branch pushed after its commits arrived elsewhere): no news.
    if (inserted.length === 0) return PROCESSED;

    const newShas = new Set(inserted.map((c) => c.sha));
    const shown = p.commits.filter((c) => newShas.has(c.id)).slice(0, COMMITS_IN_ACTIVITY);
    for (const project of target.projects) {
      const actor = await this.actor(tx, p.sender, project.workspaceId);
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor,
        entity: { type: 'repository', id: target.repo.id },
        action: 'repository.pushed',
        metadata: {
          repository: target.repo.fullName,
          branch,
          count: inserted.length,
          commits: shown.map((c) => ({
            sha: c.id.slice(0, 7),
            message: headline(c.message),
            url: c.url,
          })),
          github: githubUser(p.sender),
        },
        event: {
          type: 'github.commit.received',
          payload: {
            repositoryId: target.repo.id,
            branch,
            commitIds: inserted.slice(0, 50).map((c) => c.id),
          },
        },
      });
    }
    return PROCESSED;
  }

  // -------------------------------------------------------- pull requests

  private async pullRequest(
    tx: Transaction,
    p: z.infer<typeof pullRequestEventSchema>,
  ): Promise<ProcessResult> {
    const handled = [
      'opened',
      'reopened',
      'closed',
      'synchronize',
      'edited',
      'ready_for_review',
      'converted_to_draft',
    ];
    if (!handled.includes(p.action)) return ignored(`pull_request.${p.action} is not handled`);
    const target = await this.target(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');

    const pr = await this.upsertPullRequest(tx, target.repo, p.pull_request);
    const merged = p.action === 'closed' && Boolean(p.pull_request.merged_at);
    const action =
      p.action === 'opened' || p.action === 'reopened'
        ? p.action
        : p.action === 'closed'
          ? merged
            ? 'merged'
            : 'closed'
          : null;

    // Automatic links when a task key appears in the branch name or title (§11.10).
    if (p.action === 'opened' || p.action === 'reopened' || p.action === 'edited') {
      await this.autoLink(tx, target, pr, p.sender);
    }

    for (const project of target.projects) {
      const actor = await this.actor(tx, p.sender, project.workspaceId);
      const scope = {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor,
        entity: { type: 'pull_request' as const, id: pr.id },
      };
      const event = {
        type: 'github.pull_request.updated',
        payload: { pullRequestId: pr.id, state: stateOf(pr), action: p.action },
      };
      if (action) {
        await this.events.activity(tx, {
          ...scope,
          action: `pull_request.${action}`,
          metadata: { ...prMetadata(pr, target.repo), github: githubUser(p.sender) },
          event,
        });
      } else {
        await this.events.event(tx, event.type, scope, event.payload);
      }
    }

    if (action === 'opened') {
      await this.notifyLinkedTasks(tx, target, pr, p.sender, 'PULL_REQUEST_OPENED', 'opened');
    } else if (action === 'merged') {
      await this.notifyLinkedTasks(tx, target, pr, p.sender, 'PULL_REQUEST_MERGED', 'merged');
    }
    return PROCESSED;
  }

  private async review(
    tx: Transaction,
    p: z.infer<typeof pullRequestReviewEventSchema>,
  ): Promise<ProcessResult> {
    if (p.action !== 'submitted') return ignored(`pull_request_review.${p.action} is not handled`);
    const state = p.review.state.toLowerCase();
    if (!['approved', 'changes_requested', 'commented'].includes(state)) {
      return ignored(`review state ${state} is not handled`);
    }
    const target = await this.target(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');

    // The review payload's pull request may be older than what we have: only fill gaps.
    const pr = await this.upsertPullRequest(tx, target.repo, p.pull_request);
    const [review] = await tx
      .insert(githubReviews)
      .values({
        pullRequestId: pr.id,
        githubReviewId: p.review.id,
        reviewerLogin: p.review.user?.login ?? null,
        state,
        url: p.review.html_url ?? null,
        submittedAt: date(p.review.submitted_at) ?? new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!review) return PROCESSED; // already recorded

    for (const project of target.projects) {
      const actor = await this.actor(tx, p.sender, project.workspaceId);
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor,
        entity: { type: 'pull_request', id: pr.id },
        action: 'pull_request.reviewed',
        metadata: {
          ...prMetadata(pr, target.repo),
          review: { state, url: review.url },
          github: githubUser(p.sender),
        },
        event: {
          type: 'github.review.submitted',
          payload: { pullRequestId: pr.id, reviewId: review.id, state },
        },
      });
    }
    const verb =
      state === 'approved'
        ? 'approved'
        : state === 'changes_requested'
          ? 'reviewed (changes requested)'
          : 'reviewed';
    await this.notifyLinkedTasks(tx, target, pr, p.sender, 'PULL_REQUEST_REVIEWED', verb);
    return PROCESSED;
  }

  // ------------------------------------------------------------- release

  private async release(
    tx: Transaction,
    p: z.infer<typeof releaseEventSchema>,
  ): Promise<ProcessResult> {
    if (p.action !== 'published') return ignored(`release.${p.action} is not handled`);
    const target = await this.target(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');
    for (const project of target.projects) {
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor: await this.actor(tx, p.sender, project.workspaceId),
        entity: { type: 'repository', id: target.repo.id },
        action: 'repository.release_published',
        metadata: {
          repository: target.repo.fullName,
          release: {
            tag: p.release.tag_name,
            name: p.release.name ?? null,
            url: p.release.html_url,
            prerelease: p.release.prerelease ?? false,
          },
          github: githubUser(p.sender),
        },
      });
    }
    return PROCESSED;
  }

  // ------------------------------------------------- installation lifecycle

  private async installation(
    tx: Transaction,
    p: z.infer<typeof installationEventSchema>,
  ): Promise<ProcessResult> {
    const [installation] = await tx
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.githubInstallationId, p.installation.id));
    // Installations are bound to workspaces only through the verified install flow (0005).
    if (!installation) return ignored('installation not bound to a workspace');

    switch (p.action) {
      case 'deleted': {
        await tx
          .update(githubInstallations)
          .set({ status: 'REMOVED' })
          .where(eq(githubInstallations.id, installation.id));
        const repos = await tx
          .select()
          .from(githubRepositories)
          .where(eq(githubRepositories.installationId, installation.id));
        for (const repo of repos) await this.disconnect(tx, repo, 'app_uninstalled');
        return PROCESSED;
      }
      case 'suspend':
        await tx
          .update(githubInstallations)
          .set({ status: 'SUSPENDED', suspendedAt: new Date() })
          .where(eq(githubInstallations.id, installation.id));
        return PROCESSED;
      case 'unsuspend':
        await tx
          .update(githubInstallations)
          .set({ status: 'ACTIVE', suspendedAt: null })
          .where(eq(githubInstallations.id, installation.id));
        return PROCESSED;
      default:
        return ignored(`installation.${p.action} is not handled`);
    }
  }

  private async installationRepositories(
    tx: Transaction,
    p: z.infer<typeof installationRepositoriesEventSchema>,
  ): Promise<ProcessResult> {
    if (p.action !== 'removed')
      return ignored(`installation_repositories.${p.action} is not handled`);
    if (p.repositories_removed.length === 0) return ignored('no repositories removed');
    const repos = await tx
      .select({ repo: githubRepositories })
      .from(githubRepositories)
      .innerJoin(githubInstallations, eq(githubInstallations.id, githubRepositories.installationId))
      .where(
        and(
          eq(githubInstallations.githubInstallationId, p.installation.id),
          inArray(
            githubRepositories.githubRepositoryId,
            p.repositories_removed.map((r) => r.id),
          ),
        ),
      );
    if (repos.length === 0) return ignored('removed repositories were not connected');
    for (const { repo } of repos) await this.disconnect(tx, repo, 'access_removed');
    return PROCESSED;
  }

  /**
   * GitHub no longer lets DevTrack read this repository: disconnect it from every project and
   * stop accepting its events. The repository row and its history are kept (§11.9).
   */
  private async disconnect(tx: Transaction, repo: RepoRow, reason: string): Promise<void> {
    const removed = await tx
      .delete(projectRepositories)
      .where(eq(projectRepositories.repositoryId, repo.id))
      .returning({ projectId: projectRepositories.projectId });
    if (!repo.disconnectedAt) {
      await tx
        .update(githubRepositories)
        .set({ disconnectedAt: new Date() })
        .where(eq(githubRepositories.id, repo.id));
    }
    if (removed.length === 0) return;
    const affected = await tx
      .select({ id: projects.id, workspaceId: projects.workspaceId })
      .from(projects)
      .where(
        inArray(
          projects.id,
          removed.map((r) => r.projectId),
        ),
      );
    for (const project of affected) {
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor: null,
        entity: { type: 'project', id: project.id },
        action: 'project.repository_disconnected',
        metadata: { repository: { id: repo.id, fullName: repo.fullName }, reason },
        event: { type: 'project.repository_disconnected', payload: { repositoryId: repo.id } },
      });
    }
  }

  // --------------------------------------------------------------- helpers

  /**
   * The repository, if it is currently connected to at least one project. Activity goes only to
   * non-archived projects (archived projects are read-only).
   */
  private async target(
    tx: Transaction,
    githubInstallationId: number,
    githubRepositoryId: number,
  ): Promise<Target | null> {
    const [row] = await tx
      .select({ repo: githubRepositories, workspaceId: githubInstallations.workspaceId })
      .from(githubRepositories)
      .innerJoin(githubInstallations, eq(githubInstallations.id, githubRepositories.installationId))
      .where(
        and(
          eq(githubInstallations.githubInstallationId, githubInstallationId),
          eq(githubRepositories.githubRepositoryId, githubRepositoryId),
          isNull(githubRepositories.disconnectedAt),
        ),
      );
    if (!row) return null;
    const connected = await tx
      .select({ id: projects.id, workspaceId: projects.workspaceId, key: projects.key })
      .from(projectRepositories)
      .innerJoin(projects, eq(projects.id, projectRepositories.projectId))
      .where(
        and(
          eq(projectRepositories.repositoryId, row.repo.id),
          // Defence in depth: never deliver into another workspace's project.
          eq(projects.workspaceId, row.workspaceId),
          ne(projects.status, 'ARCHIVED'),
        ),
      );
    if (connected.length === 0) return null;
    return { repo: row.repo, workspaceId: row.workspaceId, projects: connected };
  }

  /**
   * Inserts or refreshes a pull request. Deliveries can arrive out of order, so an existing row
   * is only overwritten by data at least as recent (GitHub's `updated_at`).
   */
  private async upsertPullRequest(
    tx: Transaction,
    repo: RepoRow,
    pr: PullRequestPayload,
  ): Promise<PrRow> {
    const values = {
      title: pr.title.slice(0, 500),
      url: pr.html_url,
      authorLogin: pr.user?.login ?? null,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
      state: pr.state,
      isDraft: pr.draft ?? false,
      mergedAt: date(pr.merged_at),
      closedAt: date(pr.closed_at),
      githubUpdatedAt: new Date(pr.updated_at),
    };
    const [row] = await tx
      .insert(githubPullRequests)
      .values({
        ...values,
        repositoryId: repo.id,
        githubPrId: pr.id,
        number: pr.number,
        openedAt: new Date(pr.created_at),
      })
      .onConflictDoUpdate({
        target: [githubPullRequests.repositoryId, githubPullRequests.githubPrId],
        set: values,
        setWhere: sql`${githubPullRequests.githubUpdatedAt} <= excluded.github_updated_at`,
      })
      .returning();
    if (row) return row;
    const [existing] = await tx
      .select()
      .from(githubPullRequests)
      .where(
        and(eq(githubPullRequests.repositoryId, repo.id), eq(githubPullRequests.githubPrId, pr.id)),
      );
    return existing!;
  }

  /** Links tasks whose keys appear in the branch name or title (never removes links). */
  private async autoLink(
    tx: Transaction,
    target: Target,
    pr: PrRow,
    sender: z.infer<typeof senderSchema>,
  ): Promise<void> {
    const keys = extractTaskKeys(pr.headBranch, pr.title);
    if (keys.length === 0) return;
    for (const project of target.projects) {
      const numbers = keys
        .filter((k) => k.slice(0, k.lastIndexOf('-')) === project.key)
        .map((k) => Number(k.slice(k.lastIndexOf('-') + 1)));
      if (numbers.length === 0) continue;
      const found = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, project.id),
            inArray(tasks.taskNumber, numbers),
            isNull(tasks.deletedAt),
          ),
        );
      if (found.length === 0) continue;
      const created = await tx
        .insert(taskGithubLinks)
        .values(found.map((t) => ({ taskId: t.id, pullRequestId: pr.id, source: 'AUTO' as const })))
        .onConflictDoNothing()
        .returning({ taskId: taskGithubLinks.taskId });
      const actor = await this.actor(tx, sender, project.workspaceId);
      for (const { taskId } of created) {
        await this.events.activity(tx, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          taskId,
          actor,
          entity: { type: 'pull_request', id: pr.id },
          action: 'pull_request.linked',
          metadata: { ...prMetadata(pr, target.repo), auto: true, github: githubUser(sender) },
        });
      }
    }
  }

  /**
   * Notifies the reporter and assignees of every task linked to the pull request, if they can
   * still access the project. The GitHub sender, when linked to a DevTrack user, is skipped.
   */
  private async notifyLinkedTasks(
    tx: Transaction,
    target: Target,
    pr: PrRow,
    sender: z.infer<typeof senderSchema>,
    type: NotificationType,
    verb: string,
  ): Promise<void> {
    const linked = await tx
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        number: tasks.taskNumber,
        reporterId: tasks.reporterId,
      })
      .from(taskGithubLinks)
      .innerJoin(tasks, eq(tasks.id, taskGithubLinks.taskId))
      .where(
        and(
          eq(taskGithubLinks.pullRequestId, pr.id),
          isNull(tasks.deletedAt),
          inArray(
            tasks.projectId,
            target.projects.map((p) => p.id),
          ),
        ),
      );
    for (const task of linked) {
      const project = target.projects.find((p) => p.id === task.projectId)!;
      const assignees = await tx
        .select({ id: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, task.id));
      const wanted = new Set([task.reporterId, ...assignees.map((a) => a.id)].filter(Boolean));
      if (wanted.size === 0) continue;
      const audience = await this.projectAccess.audience(project, {}, tx);
      const recipients = audience.filter((u) => wanted.has(u.id));
      const actor = await this.actor(tx, sender, project.workspaceId);
      await this.events.notify(
        tx,
        actor,
        recipients.map((u) => ({
          userId: u.id,
          workspaceId: project.workspaceId,
          projectId: project.id,
          type,
          title: `Pull request #${pr.number} ${verb} for ${project.key}-${task.number}`,
          body: pr.title,
          resourceType: 'task',
          resourceId: task.id,
        })),
      );
    }
  }

  /**
   * The DevTrack user behind a GitHub sender: a person who signed in with GitHub (linked by
   * numeric ID) and belongs to the workspace. Otherwise null, and the GitHub login is shown.
   */
  private async actor(
    tx: Transaction,
    sender: z.infer<typeof senderSchema>,
    workspaceId: string,
  ): Promise<Actor | null> {
    if (!sender || sender.type === 'Bot') return null;
    const [row] = await tx
      .select({ id: users.id, username: users.username })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, workspaceId)),
      )
      .where(
        and(eq(accounts.provider, 'github'), eq(accounts.providerAccountId, String(sender.id))),
      );
    return row ?? null;
  }
}

export function stateOf(pr: Pick<PrRow, 'state' | 'mergedAt'>): 'open' | 'closed' | 'merged' {
  if (pr.mergedAt) return 'merged';
  return pr.state === 'open' ? 'open' : 'closed';
}

function prMetadata(pr: PrRow, repo: RepoRow) {
  return {
    repository: repo.fullName,
    pullRequest: { id: pr.id, number: pr.number, title: pr.title, url: pr.url },
  };
}

function githubUser(sender: z.infer<typeof senderSchema>) {
  return sender ? { login: sender.login } : null;
}

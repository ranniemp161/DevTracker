import { Injectable } from '@nestjs/common';
import {
  accounts,
  and,
  eq,
  githubCheckSuites,
  githubCommits,
  githubInstallations,
  githubPullRequests,
  githubRepositories,
  githubReviews,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  taskAssignees,
  taskDonePrompts,
  taskGithubLinks,
  tasks,
  users,
  workspaceMembers,
  type Transaction,
} from '@devtrack/database';
import type { ChecksState, NotificationType } from '@devtrack/types';
import { extractTaskKeys } from '@devtrack/validators';
import type { z } from 'zod';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';
import { ProjectAccessService } from '../../projects/project-access.service';
import {
  numbersForProject,
  TaskStatusAutomation,
} from '../../tasks/task-status-automation.service';
import { RepositoryAccess, type Target } from '../access/repository-access.service';
import { GithubChatFeed } from './github-chat-feed.service';
import {
  installationEventSchema,
  installationRepositoriesEventSchema,
  pullRequestEventSchema,
  pullRequestReviewEventSchema,
  pushEventSchema,
  releaseEventSchema,
  checkRunEventSchema,
  checkSuiteEventSchema,
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
 * GitHub events move linked tasks forward but never to Done (decision record 0021).
 */
@Injectable()
export class GithubEventProcessor {
  constructor(
    private readonly events: EventRecorder,
    private readonly projectAccess: ProjectAccessService,
    private readonly chat: GithubChatFeed,
    private readonly automation: TaskStatusAutomation,
    private readonly access: RepositoryAccess,
  ) {}

  /**
   * Imports existing pull requests of a connected repository (decision record 0006, M7 fix):
   * stores them with the same out-of-order guard as webhooks and auto-links task keys, but
   * records no activity, outbox events or notifications, because this is history, not news.
   * Returns how many were stored or refreshed; 0 if the repository is not connected.
   */
  async importPullRequests(
    tx: Transaction,
    githubInstallationId: number,
    githubRepositoryId: number,
    pullRequests: PullRequestPayload[],
  ): Promise<number> {
    const target = await this.access.targets(tx, githubInstallationId, githubRepositoryId);
    if (!target) return 0;
    for (const payload of pullRequests) {
      const pr = await this.upsertPullRequest(tx, target.repo, payload);
      await this.autoLink(tx, target, pr, undefined, { recordActivity: false });
    }
    return pullRequests.length;
  }

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
      case 'check_suite':
        return this.parse(checkSuiteEventSchema, payload, (p) => this.checkSuite(tx, p));
      case 'check_run':
        return this.parse(checkRunEventSchema, payload, (p) => this.checkRun(tx, p));
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
    const target = await this.access.targets(tx, p.installation.id, p.repository.id);
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

    // A task key in the branch name or a new commit message starts the task (0021). Only newly
    // stored commits count, so a retried delivery or a re-push moves nothing twice.
    for (const commit of p.commits.filter((c) => newShas.has(c.id))) {
      const keys = extractTaskKeys(branch, commit.message);
      if (keys.length === 0) continue;
      for (const project of target.projects) {
        await this.automation.advanceByNumbers(
          tx,
          project,
          numbersForProject(project.key, keys),
          'IN_PROGRESS',
          { trigger: 'commit', repository: target.repo.fullName, sha: commit.id, url: commit.url },
        );
      }
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
    const target = await this.access.targets(tx, p.installation.id, p.repository.id);
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
        await this.chat.post(tx, project, actor, {
          event: action === 'reopened' ? 'pull_request.opened' : `pull_request.${action}`,
          ...chatPr(pr, target.repo, p.sender),
        });
      } else {
        await this.events.event(tx, event.type, scope, event.payload);
      }
    }

    // A linked PR that is ready for review moves its tasks to In review (0021). Drafts wait
    // until they are marked ready.
    const readyForReview =
      p.action === 'ready_for_review' ||
      ((p.action === 'opened' || p.action === 'reopened') && !p.pull_request.draft);
    if (readyForReview) await this.moveLinkedToReview(tx, target, pr);

    // A new head commit has its own checks (0015).
    await this.refreshChecks(tx, target, pr, p.sender);

    if (action === 'opened') {
      await this.notifyLinkedTasks(tx, target, pr, p.sender, 'PULL_REQUEST_OPENED', 'opened');
    } else if (action === 'merged') {
      // Asks whether linked tasks are done; never marks them Done itself (0021 §4).
      await this.promptDone(tx, target, pr);
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
    const target = await this.access.targets(tx, p.installation.id, p.repository.id);
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
      if (state === 'approved' || state === 'changes_requested') {
        await this.chat.post(tx, project, actor, {
          event: state === 'approved' ? 'review.approved' : 'review.changes_requested',
          ...chatPr(pr, target.repo, p.sender),
        });
      }
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
    const target = await this.access.targets(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');
    for (const project of target.projects) {
      const actor = await this.actor(tx, p.sender, project.workspaceId);
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor,
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
      await this.chat.post(tx, project, actor, {
        event: 'release.published',
        repository: target.repo.fullName,
        sender: p.sender?.login ?? null,
        release: { tag: p.release.tag_name, name: p.release.name ?? null, url: p.release.html_url },
      });
    }
    return PROCESSED;
  }

  // ------------------------------------------------------- CI status (0015)

  private async checkSuite(
    tx: Transaction,
    p: z.infer<typeof checkSuiteEventSchema>,
  ): Promise<ProcessResult> {
    if (p.action !== 'completed') return ignored(`check_suite.${p.action} is not handled`);
    const target = await this.access.targets(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');
    const suite = p.check_suite;

    const completedAt = date(suite.updated_at) ?? new Date();
    const values = {
      headSha: suite.head_sha,
      appSlug: suite.app?.slug ?? null,
      conclusion: suite.conclusion ?? null,
      completedAt,
    };
    await tx
      .insert(githubCheckSuites)
      .values({ ...values, repositoryId: target.repo.id, githubSuiteId: suite.id })
      .onConflictDoUpdate({
        target: [githubCheckSuites.repositoryId, githubCheckSuites.githubSuiteId],
        set: values,
        // A late result from before a re-run started doesn't end the re-run (§8).
        setWhere: or(
          isNull(githubCheckSuites.startedAt),
          lte(githubCheckSuites.startedAt, completedAt),
        ),
      });
    await this.refreshPullRequestsAt(
      tx,
      target,
      suite.head_sha,
      suite.pull_requests.map((pr) => pr.id),
      p.sender,
    );
    return PROCESSED;
  }

  /** A check run was created, so its suite is running until the suite completes (0015 §8). */
  private async checkRun(
    tx: Transaction,
    p: z.infer<typeof checkRunEventSchema>,
  ): Promise<ProcessResult> {
    if (p.action !== 'created') return ignored(`check_run.${p.action} is not handled`);
    // Some apps add a run that is already finished to a suite that already completed (Vercel's
    // preview comments). GitHub sends no new suite result for it, so it must not reopen the suite.
    if (p.check_run.status === 'completed') return ignored('check run was created completed');
    const target = await this.access.targets(tx, p.installation.id, p.repository.id);
    if (!target) return ignored('repository not connected');
    const run = p.check_run;
    const startedAt = date(run.started_at) ?? new Date();

    await tx
      .insert(githubCheckSuites)
      .values({
        repositoryId: target.repo.id,
        githubSuiteId: run.check_suite.id,
        headSha: run.head_sha,
        appSlug: run.app?.slug ?? null,
        conclusion: null,
        startedAt,
        completedAt: null,
      })
      .onConflictDoUpdate({
        target: [githubCheckSuites.repositoryId, githubCheckSuites.githubSuiteId],
        set: { conclusion: null, completedAt: null, startedAt },
        // Only a run newer than the suite's last result (a re-run) reopens it; a late
        // delivery for a run that already finished changes nothing.
        setWhere: and(
          or(isNull(githubCheckSuites.completedAt), lt(githubCheckSuites.completedAt, startedAt)),
          or(isNull(githubCheckSuites.startedAt), lt(githubCheckSuites.startedAt, startedAt)),
        ),
      });
    await this.refreshPullRequestsAt(
      tx,
      target,
      run.head_sha,
      run.pull_requests.map((pr) => pr.id),
      p.sender,
    );
    return PROCESSED;
  }

  /** Refreshes the PRs a suite applies to: the ones GitHub lists, plus open PRs at its commit. */
  private async refreshPullRequestsAt(
    tx: Transaction,
    target: Target,
    headSha: string,
    listed: number[],
    sender: z.infer<typeof senderSchema>,
  ): Promise<void> {
    // `listed` is empty for forks; the head SHA still finds those PRs.
    const prs = await tx
      .select()
      .from(githubPullRequests)
      .where(
        and(
          eq(githubPullRequests.repositoryId, target.repo.id),
          or(
            listed.length > 0 ? inArray(githubPullRequests.githubPrId, listed) : sql`false`,
            and(eq(githubPullRequests.headSha, headSha), eq(githubPullRequests.state, 'open')),
          ),
        ),
      );
    for (const pr of prs) {
      // Rows stored before 0015 have no head SHA yet: a listed suite tells us it.
      const current = pr.headSha
        ? pr
        : (
            await tx
              .update(githubPullRequests)
              .set({ headSha })
              .where(eq(githubPullRequests.id, pr.id))
              .returning()
          )[0]!;
      await this.refreshChecks(tx, target, current, sender);
    }
  }

  /**
   * Recomputes a PR's checks state from the suites on its head commit, and posts to chat
   * when it newly fails (0015 §3–4).
   */
  private async refreshChecks(
    tx: Transaction,
    target: Target,
    pr: PrRow,
    sender: z.infer<typeof senderSchema>,
  ): Promise<void> {
    if (!pr.headSha) return;
    const suites = await tx
      .select({
        conclusion: githubCheckSuites.conclusion,
        completedAt: githubCheckSuites.completedAt,
      })
      .from(githubCheckSuites)
      .where(
        and(
          eq(githubCheckSuites.repositoryId, pr.repositoryId),
          eq(githubCheckSuites.headSha, pr.headSha),
        ),
      );
    const next = checksState(suites);
    if (next === pr.checksState) return;
    await tx
      .update(githubPullRequests)
      .set({ checksState: next })
      .where(eq(githubPullRequests.id, pr.id));
    for (const project of target.projects) {
      const actor = await this.actor(tx, sender, project.workspaceId);
      // Open boards and task pages refetch, so card badges follow CI live.
      await this.events.event(
        tx,
        'github.pull_request.updated',
        {
          workspaceId: project.workspaceId,
          projectId: project.id,
          actor,
          entity: { type: 'pull_request', id: pr.id },
        },
        { pullRequestId: pr.id, state: stateOf(pr), action: 'checks' },
      );
      if (next === 'failing') {
        await this.chat.post(tx, project, actor, {
          event: 'checks.failed',
          ...chatPr(pr, target.repo, sender),
        });
      }
    }
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
        await this.access.revokeOnGitHub(tx, installation, 'all', 'app_uninstalled');
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
    const [installation] = await tx
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.githubInstallationId, p.installation.id));
    const revoked = installation
      ? await this.access.revokeOnGitHub(
          tx,
          installation,
          p.repositories_removed.map((r) => r.id),
          'access_removed',
        )
      : 0;
    if (revoked === 0) return ignored('removed repositories were not connected');
    return PROCESSED;
  }

  // --------------------------------------------------------------- helpers

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
      // Older payloads (and test fixtures) may omit it; never clear a known SHA.
      ...(pr.head.sha ? { headSha: pr.head.sha } : {}),
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
    options: { recordActivity?: boolean } = {},
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
      if (options.recordActivity === false) continue;
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
   * Opens a "Mark done?" prompt on every linked task that isn't Done, and asks its assignees (or
   * the reporter when nobody is assigned) in the bell. One prompt per task and pull request, so
   * a retried delivery asks nothing twice. The person who merged is asked too: it's a to-do, not
   * news about their own action.
   */
  private async promptDone(tx: Transaction, target: Target, pr: PrRow): Promise<void> {
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
          ne(tasks.status, 'DONE'),
          inArray(
            tasks.projectId,
            target.projects.map((p) => p.id),
          ),
        ),
      );
    for (const task of linked) {
      const [prompt] = await tx
        .insert(taskDonePrompts)
        .values({ taskId: task.id, pullRequestId: pr.id })
        .onConflictDoNothing()
        .returning({ id: taskDonePrompts.id });
      if (!prompt) continue;
      const project = target.projects.find((p) => p.id === task.projectId)!;
      await this.events.event(
        tx,
        'task.updated',
        {
          workspaceId: project.workspaceId,
          projectId: project.id,
          actor: null,
          entity: { type: 'task', id: task.id },
        },
        { taskId: task.id, donePrompt: true },
      );

      const assignees = await tx
        .select({ id: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, task.id));
      const wanted = new Set(
        assignees.length > 0 ? assignees.map((a) => a.id) : [task.reporterId].filter(Boolean),
      );
      if (wanted.size === 0) continue;
      const audience = await this.projectAccess.audience(project, {}, tx);
      const key = `${project.key}-${task.number}`;
      await this.events.notify(
        tx,
        null,
        audience
          .filter((u) => wanted.has(u.id))
          .map((u) => ({
            userId: u.id,
            workspaceId: project.workspaceId,
            projectId: project.id,
            type: 'TASK_DONE_PROMPT' as const,
            title: `Pull request #${pr.number} merged. Mark ${key} done?`,
            body: pr.title,
            resourceType: 'task',
            resourceId: task.id,
          })),
      );
    }
  }

  private async moveLinkedToReview(tx: Transaction, target: Target, pr: PrRow): Promise<void> {
    const linked = await tx
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(taskGithubLinks)
      .innerJoin(tasks, eq(tasks.id, taskGithubLinks.taskId))
      .where(eq(taskGithubLinks.pullRequestId, pr.id));
    for (const project of target.projects) {
      const ids = linked.filter((t) => t.projectId === project.id).map((t) => t.id);
      await this.automation.advanceByIds(tx, project, ids, 'IN_REVIEW', {
        trigger: 'pull_request',
        repository: target.repo.fullName,
        prNumber: pr.number,
        url: pr.url,
      });
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

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required']);
const OK = new Set(['success', 'neutral', 'skipped']);

/**
 * A PR's checks state from the suites on its head commit (0015 §3, §8): any failure wins, then
 * any suite still running, then passing once every suite passed.
 */
export function checksState(
  suites: { conclusion: string | null; completedAt: Date | null }[],
): ChecksState | null {
  if (suites.length === 0) return null;
  const done = suites.filter((s) => s.completedAt !== null);
  if (done.some((s) => s.conclusion !== null && FAILED.has(s.conclusion))) return 'failing';
  if (done.length < suites.length) return 'running';
  return done.every((s) => s.conclusion !== null && OK.has(s.conclusion)) ? 'passing' : null;
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

/** Chat details for a pull request event (0014). */
function chatPr(pr: PrRow, repo: RepoRow, sender: z.infer<typeof senderSchema>) {
  return {
    repository: repo.fullName,
    sender: sender?.login ?? null,
    pullRequest: { number: pr.number, title: pr.title, url: pr.url },
  };
}

function githubUser(sender: z.infer<typeof senderSchema>) {
  return sender ? { login: sender.login } : null;
}

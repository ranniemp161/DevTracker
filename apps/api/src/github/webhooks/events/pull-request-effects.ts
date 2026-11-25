import {
  and,
  eq,
  githubCheckSuites,
  githubPullRequests,
  inArray,
  isNull,
  ne,
  sql,
  taskAssignees,
  taskDonePrompts,
  taskGithubLinks,
  tasks,
  type Transaction,
} from '@devtrack/database';
import type { ChecksState, NotificationType } from '@devtrack/types';
import { extractTaskKeys } from '@devtrack/validators';
import type { z } from 'zod';
import type { Target } from '../../access/repository-access.service';
import { type PullRequestPayload, type senderSchema } from '../payloads';
import {
  chatPr,
  date,
  githubUser,
  prMetadata,
  senderActor,
  type EventDeps,
  type PrRow,
  type RepoRow,
} from './shared';

/**
 * Inserts or refreshes a pull request. Deliveries can arrive out of order, so an existing row
 * is only overwritten by data at least as recent (GitHub's `updated_at`).
 */
export async function upsertPullRequest(
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
export async function autoLink(
  deps: EventDeps,
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
    const actor = await senderActor(tx, sender, project.workspaceId);
    for (const { taskId } of created) {
      await deps.events.activity(tx, {
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
export async function promptDone(
  deps: EventDeps,
  tx: Transaction,
  target: Target,
  pr: PrRow,
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
    await deps.events.event(
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
    const audience = await deps.projectAccess.audience(project, {}, tx);
    const key = `${project.key}-${task.number}`;
    await deps.events.notify(
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

export async function moveLinkedToReview(
  deps: EventDeps,
  tx: Transaction,
  target: Target,
  pr: PrRow,
): Promise<void> {
  const linked = await tx
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(taskGithubLinks)
    .innerJoin(tasks, eq(tasks.id, taskGithubLinks.taskId))
    .where(eq(taskGithubLinks.pullRequestId, pr.id));
  for (const project of target.projects) {
    const ids = linked.filter((t) => t.projectId === project.id).map((t) => t.id);
    await deps.automation.advanceByIds(tx, project, ids, 'IN_REVIEW', {
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
export async function notifyLinkedTasks(
  deps: EventDeps,
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
    const audience = await deps.projectAccess.audience(project, {}, tx);
    const recipients = audience.filter((u) => wanted.has(u.id));
    const actor = await senderActor(tx, sender, project.workspaceId);
    await deps.events.notify(
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
 * Recomputes a PR's checks state from the suites on its head commit, and posts to chat
 * when it newly fails (0015 §3–4).
 */
export async function refreshChecks(
  deps: EventDeps,
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
    const actor = await senderActor(tx, sender, project.workspaceId);
    // Open boards and task pages refetch, so card badges follow CI live.
    await deps.events.event(
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
      await deps.chat.post(tx, project, actor, {
        event: 'checks.failed',
        ...chatPr(pr, target.repo, sender),
      });
    }
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

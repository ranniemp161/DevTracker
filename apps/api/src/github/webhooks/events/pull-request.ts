import { type Transaction } from '@devtrack/database';
import type { z } from 'zod';
import { pullRequestEventSchema } from '../payloads';
import {
  chatPr,
  githubUser,
  ignored,
  PROCESSED,
  prMetadata,
  senderActor,
  type EventDeps,
  type ProcessResult,
} from './shared';
import {
  autoLink,
  moveLinkedToReview,
  notifyLinkedTasks,
  promptDone,
  refreshChecks,
  stateOf,
  upsertPullRequest,
} from './pull-request-effects';

export async function pullRequest(
  deps: EventDeps,
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
  const target = await deps.access.targets(tx, p.installation.id, p.repository.id);
  if (!target) return ignored('repository not connected');

  const pr = await upsertPullRequest(tx, target.repo, p.pull_request);
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
    await autoLink(deps, tx, target, pr, p.sender);
  }

  for (const project of target.projects) {
    const actor = await senderActor(tx, p.sender, project.workspaceId);
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
      await deps.events.activity(tx, {
        ...scope,
        action: `pull_request.${action}`,
        metadata: { ...prMetadata(pr, target.repo), github: githubUser(p.sender) },
        event,
      });
      await deps.chat.post(tx, project, actor, {
        event: action === 'reopened' ? 'pull_request.opened' : `pull_request.${action}`,
        ...chatPr(pr, target.repo, p.sender),
      });
    } else {
      await deps.events.event(tx, event.type, scope, event.payload);
    }
  }

  // A linked PR that is ready for review moves its tasks to In review (0021). Drafts wait
  // until they are marked ready.
  const readyForReview =
    p.action === 'ready_for_review' ||
    ((p.action === 'opened' || p.action === 'reopened') && !p.pull_request.draft);
  if (readyForReview) await moveLinkedToReview(deps, tx, target, pr);

  // A new head commit has its own checks (0015).
  await refreshChecks(deps, tx, target, pr, p.sender);

  if (action === 'opened') {
    await notifyLinkedTasks(deps, tx, target, pr, p.sender, 'PULL_REQUEST_OPENED', 'opened');
  } else if (action === 'merged') {
    // Asks whether linked tasks are done; never marks them Done itself (0021 §4).
    await promptDone(deps, tx, target, pr);
  }
  return PROCESSED;
}

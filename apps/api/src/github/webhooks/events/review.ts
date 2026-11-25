import { githubReviews, type Transaction } from '@devtrack/database';
import type { z } from 'zod';
import { pullRequestReviewEventSchema } from '../payloads';
import {
  chatPr,
  date,
  githubUser,
  ignored,
  PROCESSED,
  prMetadata,
  senderActor,
  type EventDeps,
  type ProcessResult,
} from './shared';
import { notifyLinkedTasks, upsertPullRequest } from './pull-request-effects';

export async function review(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof pullRequestReviewEventSchema>,
): Promise<ProcessResult> {
  if (p.action !== 'submitted') return ignored(`pull_request_review.${p.action} is not handled`);
  const state = p.review.state.toLowerCase();
  if (!['approved', 'changes_requested', 'commented'].includes(state)) {
    return ignored(`review state ${state} is not handled`);
  }
  const target = await deps.access.targets(tx, p.installation.id, p.repository.id);
  if (!target) return ignored('repository not connected');

  // The review payload's pull request may be older than what we have: only fill gaps.
  const pr = await upsertPullRequest(tx, target.repo, p.pull_request);
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
    const actor = await senderActor(tx, p.sender, project.workspaceId);
    await deps.events.activity(tx, {
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
      await deps.chat.post(tx, project, actor, {
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
  await notifyLinkedTasks(deps, tx, target, pr, p.sender, 'PULL_REQUEST_REVIEWED', verb);
  return PROCESSED;
}

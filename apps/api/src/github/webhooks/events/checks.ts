import {
  and,
  eq,
  githubCheckSuites,
  githubPullRequests,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type Transaction,
} from '@devtrack/database';
import type { z } from 'zod';
import type { Target } from '../../access/repository-access.service';
import { checkRunEventSchema, checkSuiteEventSchema, type senderSchema } from '../payloads';
import { date, ignored, PROCESSED, type EventDeps, type ProcessResult } from './shared';
import { refreshChecks } from './pull-request-effects';

export async function checkSuite(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof checkSuiteEventSchema>,
): Promise<ProcessResult> {
  if (p.action !== 'completed') return ignored(`check_suite.${p.action} is not handled`);
  const target = await deps.access.targets(tx, p.installation.id, p.repository.id);
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
  await refreshPullRequestsAt(
    deps,
    tx,
    target,
    suite.head_sha,
    suite.pull_requests.map((pr) => pr.id),
    p.sender,
  );
  return PROCESSED;
}

/** A check run was created, so its suite is running until the suite completes (0015 §8). */
export async function checkRun(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof checkRunEventSchema>,
): Promise<ProcessResult> {
  if (p.action !== 'created') return ignored(`check_run.${p.action} is not handled`);
  // Some apps add a run that is already finished to a suite that already completed (Vercel's
  // preview comments). GitHub sends no new suite result for it, so it must not reopen the suite.
  if (p.check_run.status === 'completed') return ignored('check run was created completed');
  const target = await deps.access.targets(tx, p.installation.id, p.repository.id);
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
  await refreshPullRequestsAt(
    deps,
    tx,
    target,
    run.head_sha,
    run.pull_requests.map((pr) => pr.id),
    p.sender,
  );
  return PROCESSED;
}

/** Refreshes the PRs a suite applies to: the ones GitHub lists, plus open PRs at its commit. */
export async function refreshPullRequestsAt(
  deps: EventDeps,
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
    await refreshChecks(deps, tx, target, current, sender);
  }
}

import { githubCommits, type Transaction } from '@devtrack/database';
import { extractTaskKeys } from '@devtrack/validators';
import type { z } from 'zod';
import { numbersForProject } from '../../../tasks/task-status-automation.service';
import { pushEventSchema } from '../payloads';
import {
  githubUser,
  ignored,
  PROCESSED,
  senderActor,
  type EventDeps,
  type ProcessResult,
} from './shared';

/** Activity shows at most this many commits per push. */
const COMMITS_IN_ACTIVITY = 5;
const headline = (message: string, max = 120) => {
  const first = message.split('\n', 1)[0]!.trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

export async function push(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof pushEventSchema>,
): Promise<ProcessResult> {
  if (!p.ref.startsWith('refs/heads/')) return ignored('not a branch push');
  if (p.deleted) return ignored('branch deleted');
  const target = await deps.access.targets(tx, p.installation.id, p.repository.id);
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
    const actor = await senderActor(tx, p.sender, project.workspaceId);
    await deps.events.activity(tx, {
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
      await deps.automation.advanceByNumbers(
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

import { type Transaction } from '@devtrack/database';
import type { z } from 'zod';
import { releaseEventSchema } from '../payloads';
import {
  githubUser,
  ignored,
  PROCESSED,
  senderActor,
  type EventDeps,
  type ProcessResult,
} from './shared';

export async function release(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof releaseEventSchema>,
): Promise<ProcessResult> {
  if (p.action !== 'published') return ignored(`release.${p.action} is not handled`);
  const target = await deps.access.targets(tx, p.installation.id, p.repository.id);
  if (!target) return ignored('repository not connected');
  for (const project of target.projects) {
    const actor = await senderActor(tx, p.sender, project.workspaceId);
    await deps.events.activity(tx, {
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
    await deps.chat.post(tx, project, actor, {
      event: 'release.published',
      repository: target.repo.fullName,
      sender: p.sender?.login ?? null,
      release: { tag: p.release.tag_name, name: p.release.name ?? null, url: p.release.html_url },
    });
  }
  return PROCESSED;
}

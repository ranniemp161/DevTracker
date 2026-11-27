import {
  and,
  eq,
  githubReleases,
  milestoneGithubReleases,
  milestones,
  ne,
  type Transaction,
} from '@devtrack/database';
import { releaseMatchesMilestone } from '@devtrack/server-core';
import { releaseActivity } from '../../../milestones/milestones.service';
import type { z } from 'zod';
import { releaseEventSchema } from '../payloads';
import {
  date,
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

  // 0026 §3: one row per tag; a re-publish refreshes it.
  const fields = {
    name: p.release.name ?? null,
    url: p.release.html_url,
    prerelease: p.release.prerelease ?? false,
    publishedAt: date(p.release.published_at) ?? new Date(),
  };
  const [stored] = await tx
    .insert(githubReleases)
    .values({ repositoryId: target.repo.id, tagName: p.release.tag_name, ...fields })
    .onConflictDoUpdate({
      target: [githubReleases.repositoryId, githubReleases.tagName],
      set: fields,
    })
    .returning();
  const release = { ...stored!, repository: target.repo.fullName };

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

    // 0026 §3: link to undelivered milestones whose name matches. Display only: stages never move.
    const open = await tx
      .select({ id: milestones.id, name: milestones.name })
      .from(milestones)
      .where(and(eq(milestones.projectId, project.id), ne(milestones.status, 'DELIVERED')));
    for (const milestone of open.filter((m) => releaseMatchesMilestone(release, m.name))) {
      const added = await tx
        .insert(milestoneGithubReleases)
        .values({ milestoneId: milestone.id, releaseId: release.id, source: 'AUTO' })
        .onConflictDoNothing()
        .returning({ releaseId: milestoneGithubReleases.releaseId });
      if (added.length === 0) continue;
      await deps.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor: null,
        entity: { type: 'milestone', id: milestone.id },
        action: 'milestone.release_linked',
        metadata: releaseActivity(milestone.name, release, 'AUTO'),
      });
    }
  }
  return PROCESSED;
}

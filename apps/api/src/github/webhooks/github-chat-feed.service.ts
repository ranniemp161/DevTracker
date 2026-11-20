import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq, projectMessages, projects, sql, type Transaction } from '@devtrack/database';
import type { ChatGithubEvent, ProjectMessageGithub } from '@devtrack/types';
import { EventRecorder, type Actor } from '../../events/event-recorder.service';

export interface ChatFeedProject {
  id: string;
  workspaceId: string;
  chatGithubEvents: string[];
}

/**
 * Posts GitHub events to project chat (decision record 0014). Runs inside the webhook
 * delivery's transaction, so a delivery posts at most once and a failed one posts nothing.
 * GitHub messages count as unread but never send phone push or bell notifications.
 */
@Injectable()
export class GithubChatFeed {
  constructor(private readonly events: EventRecorder) {}

  async post(
    tx: Transaction,
    project: ChatFeedProject,
    /** The GitHub sender's DevTrack account, or null when it isn't linked to a member. */
    actor: Actor | null,
    details: ProjectMessageGithub,
  ): Promise<void> {
    if (!project.chatGithubEvents.includes(details.event)) return;

    // Same gapless sequence allocation as user messages (0009 §2).
    const [row] = await tx
      .update(projects)
      .set({ nextMessageSequence: sql`${projects.nextMessageSequence} + 1` })
      .where(eq(projects.id, project.id))
      .returning({ next: projects.nextMessageSequence });
    if (!row) return;

    const [message] = await tx
      .insert(projectMessages)
      .values({
        projectId: project.id,
        authorId: null,
        kind: 'github',
        body: summarize(details),
        metadata: details as unknown as Record<string, unknown>,
        sequence: row.next - 1,
        // Deliveries are applied exactly once (0006 §1); this only has to be unique.
        clientRequestId: `github:${randomUUID()}`,
      })
      .returning({ id: projectMessages.id, sequence: projectMessages.sequence });

    await this.events.event(
      tx,
      'chat.message.created',
      {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actor,
        entity: { type: 'chat_message', id: message!.id },
      },
      {
        messageId: message!.id,
        sequence: message!.sequence,
        projectId: project.id,
        actorId: actor?.id ?? null,
      },
    );
  }
}

/** Plain-text summary stored in `body` for previews and older clients. */
export function summarize(d: ProjectMessageGithub): string {
  if (d.release) {
    return `Release ${d.release.name ?? d.release.tag} published in ${d.repository}`;
  }
  const pr = d.pullRequest ? `PR #${d.pullRequest.number}` : 'A pull request';
  const title = d.pullRequest ? `: ${d.pullRequest.title}` : '';
  const what: Record<ChatGithubEvent, string> = {
    'pull_request.opened': `${pr} opened`,
    'pull_request.merged': `${pr} merged`,
    'pull_request.closed': `${pr} closed`,
    'review.changes_requested': `Changes requested on ${pr}`,
    'review.approved': `${pr} approved`,
    'release.published': `Release published in ${d.repository}`,
    'checks.failed': `Checks failed on ${pr}`,
  };
  return `${what[d.event]}${title}`;
}

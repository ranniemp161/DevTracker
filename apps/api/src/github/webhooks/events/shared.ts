import {
  accounts,
  and,
  eq,
  githubPullRequests,
  githubRepositories,
  users,
  workspaceMembers,
  type Transaction,
} from '@devtrack/database';
import type { z } from 'zod';
import type { Actor } from '../../../events/event-recorder.service';
import { type senderSchema } from '../payloads';
import type { EventRecorder } from '../../../events/event-recorder.service';
import type { ProjectAccessService } from '../../../projects/project-access.service';
import type { TaskStatusAutomation } from '../../../tasks/task-status-automation.service';
import type { RepositoryAccess } from '../../access/repository-access.service';
import type { GithubChatFeed } from '../github-chat-feed.service';

export interface ProcessResult {
  status: 'PROCESSED' | 'IGNORED';
  /** Why a delivery was ignored (stored; never contains payload data). */
  reason?: string;
}

export const ignored = (reason: string): ProcessResult => ({ status: 'IGNORED', reason });
export const PROCESSED: ProcessResult = { status: 'PROCESSED' };

/** What the event handlers work with; GithubEventProcessor passes in its own services. */
export interface EventDeps {
  events: EventRecorder;
  projectAccess: ProjectAccessService;
  chat: GithubChatFeed;
  automation: TaskStatusAutomation;
  access: RepositoryAccess;
}

export type RepoRow = typeof githubRepositories.$inferSelect;
export type PrRow = typeof githubPullRequests.$inferSelect;

export const date = (v: string | null | undefined) => (v ? new Date(v) : null);

/**
 * The DevTrack user behind a GitHub sender: a person who signed in with GitHub (linked by
 * numeric ID) and belongs to the workspace. Otherwise null, and the GitHub login is shown.
 */
export async function senderActor(
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
    .where(and(eq(accounts.provider, 'github'), eq(accounts.providerAccountId, String(sender.id))));
  return row ?? null;
}

export function prMetadata(pr: PrRow, repo: RepoRow) {
  return {
    repository: repo.fullName,
    pullRequest: { id: pr.id, number: pr.number, title: pr.title, url: pr.url },
  };
}

/** Chat details for a pull request event (0014). */
export function chatPr(pr: PrRow, repo: RepoRow, sender: z.infer<typeof senderSchema>) {
  return {
    repository: repo.fullName,
    sender: sender?.login ?? null,
    pullRequest: { number: pr.number, title: pr.title, url: pr.url },
  };
}

export function githubUser(sender: z.infer<typeof senderSchema>) {
  return sender ? { login: sender.login } : null;
}

import type { TaskStatus, UserRef } from './project.js';

export interface ProjectMessageTaskRef {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
}

/** GitHub events a project can post to its chat (decision record 0014). */
export const CHAT_GITHUB_EVENTS = [
  'pull_request.opened',
  'pull_request.merged',
  'pull_request.closed',
  'review.changes_requested',
  'review.approved',
  'release.published',
  'checks.failed',
] as const;
export type ChatGithubEvent = (typeof CHAT_GITHUB_EVENTS)[number];

/** Display details of a GitHub event posted to chat. URLs are https (0006 §4). */
export interface ProjectMessageGithub {
  event: ChatGithubEvent;
  /** `owner/name`. */
  repository: string;
  /** GitHub login of whoever triggered the event. */
  sender: string | null;
  pullRequest?: { number: number; title: string; url: string };
  release?: { tag: string; name: string | null; url: string };
}

export interface ProjectMessage {
  id: string;
  projectId: string;
  sequence: number;
  clientRequestId: string;
  /** 'github' messages have no author; their details are in `github`. */
  kind: 'user' | 'github';
  author: UserRef | null;
  github: ProjectMessageGithub | null;
  /** Plain text body. `null` once deleted: placeholder. */
  body: string | null;
  attachment?: { name: string };
  deleted: boolean;
  edited: boolean;
  task: ProjectMessageTaskRef | null;
  mentions: UserRef[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
}

export interface ProjectMessagePage {
  messages: ProjectMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  /** First unread message when opening a conversation in catch-up mode. */
  unreadMessageId?: string;
}

export interface ProjectChatReadState {
  projectId: string;
  userId: string;
  lastReadSequence: number;
  updatedAt: string;
}

export interface ProjectChatUnreadSummary {
  projectId: string;
  unreadCount: number;
}

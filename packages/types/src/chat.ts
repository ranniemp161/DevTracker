import type { TaskStatus, UserRef } from './project.js';

export interface ProjectMessageTaskRef {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
}

export interface ProjectMessage {
  id: string;
  projectId: string;
  sequence: number;
  clientRequestId: string;
  author: UserRef | null;
  /** Plain text body. `null` once deleted: placeholder. */
  body: string | null;
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

import type { UserRef } from './project.js';

export interface Comment {
  id: string;
  taskId: string;
  author: UserRef | null;
  /** `null` once deleted: the thread keeps a placeholder (M4 rule 1). */
  body: string | null;
  deleted: boolean;
  edited: boolean;
  mentions: UserRef[];
  createdAt: string;
  updatedAt: string;
}

/** `entityType.action`, e.g. `task.created`, `comment.deleted`, `project.member_added`. */
export type ActivityAction =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.assigned'
  | 'task.unassigned'
  | 'task.labeled'
  | 'task.unlabeled'
  | 'comment.created'
  | 'comment.deleted'
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  | 'project.member_added'
  | 'project.member_removed'
  | 'milestone.completed';

export interface ActivityEntry {
  id: string;
  action: ActivityAction;
  actor: UserRef | null;
  projectId: string | null;
  /** The related task, if any (also for comment events). */
  task: { id: string; key: string; title: string } | null;
  entity: { type: string; id: string };
  /** Minimal, display-oriented details, e.g. `{ changes: { status: { from, to } } }`. */
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const NOTIFICATION_TYPES = [
  'TASK_ASSIGNED',
  'MENTIONED',
  'COMMENT_RECEIVED',
  'PULL_REQUEST_OPENED',
  'PULL_REQUEST_MERGED',
  'PULL_REQUEST_REVIEWED',
  'MILESTONE_COMPLETED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  workspaceId: string;
  projectId: string | null;
  resourceType: string;
  resourceId: string;
  /** In-app path to open, e.g. `/projects/:id/tasks/:taskId`. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

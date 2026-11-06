/** Architecture §7.2 / §7.3 enums. */
export const ProjectStatus = {
  PLANNING: 'PLANNING',
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const TASK_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Minimal public user reference used inside other resources. */
export interface UserRef {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  status: ProjectStatus;
  /** ISO date (YYYY-MM-DD). */
  startDate: string | null;
  targetDate: string | null;
  createdBy: UserRef | null;
  memberCount: number;
  /** True for workspace Owners/Admins: may edit, archive and manage members. */
  viewerCanManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  user: UserRef & { email: string };
  addedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  number: number;
  /** Human-readable key, e.g. `DEV-104`. */
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  reporter: UserRef | null;
  assignees: UserRef[];
  labels: TaskLabel[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  /** `#rrggbb` */
  color: string;
}

/** Label as embedded in a task. */
export type TaskLabel = Pick<Label, 'id' | 'name' | 'color'>;

export type MilestoneStatus = 'OPEN' | 'COMPLETED';

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  createdAt: string;
  updatedAt: string;
}

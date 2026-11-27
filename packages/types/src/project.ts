import type { ProjectIntake } from './request.js';
import type { ChatGithubEvent } from './chat.js';
import type { ChecksState } from './github.js';
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
  /** GitHub events posted to the project's chat (decision record 0014). */
  chatGithubEvents: ChatGithubEvent[];
  /** Real counts of the project's non-deleted tasks; never an estimate. */
  taskCounts: { total: number; done: number };
  /** Request form settings (0016); null unless the viewer can manage the project. */
  intake: ProjectIntake | null;
  /** Untriaged requests from the public form (0016). */
  newRequestCount: number;
  /** Workspace Owners/Admins and this project's leads: may change the project (0023 §2). */
  viewerCanManage: boolean;
  /** Workspace Owners/Admins only: may archive, manage members and appoint leads (0023 §2). */
  viewerCanManageMembers: boolean;
  /** May list, accept and decline requests: everyone until the project has a lead (0023 §4). */
  viewerCanTriage: boolean;
  /** "Require triage for new tasks" (0023 §3, 0024 §2); in effect as soon as it is on. */
  internalTriage: boolean;
  /** Triage is required and the viewer isn't a lead or admin: they propose tasks. */
  viewerMustPropose: boolean;
  /** The project's leads (0023 §2), by username. */
  leads: (UserRef & { jobTitle: string | null })[];
  createdAt: string;
  updatedAt: string;
}

/** Decision record 0023 §2. */
export type ProjectMemberRole = 'lead' | 'member';

export interface ProjectMember {
  /** `jobTitle` is display only (0023 §7). */
  user: UserRef & { email: string; jobTitle: string | null };
  role: ProjectMemberRole;
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
  /** Milestone (deliverable) this task counts toward, in the same project. */
  milestoneId: string | null;
  /** Joined its milestone after the milestone first became Active (0025 §3). */
  addedAfterStart: boolean;
  /** Expected effort in minutes; null when not estimated. */
  estimateMinutes: number | null;
  /** Sum of the task's time entries, in minutes. Real logged time, never an estimate. */
  loggedMinutes: number;
  /**
   * CI on the task's open linked pull requests (0015): `failing` if any fails, else `running`
   * if any is running, else `passing` if some pass; null when no open linked PR has checks.
   */
  checks: ChecksState | null;
  /** Checklist progress (decision record 0018); `total` is 0 without a checklist. */
  checklist: { done: number; total: number };
  /** Open (not Done) tasks that block this one (decision record 0020). */
  blockedByCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** A task in the "My tasks" view, with the project it belongs to. */
export interface MyTask extends Task {
  project: { id: string; key: string; name: string };
}

/** GET /workspaces/:id/my-tasks: open tasks assigned to the caller, most urgent first. */
export interface MyTasksResponse {
  tasks: MyTask[];
  /** More open assignments exist than were returned (the view shows "100+"). */
  hasMore: boolean;
}

/** Time logged against a task (decision record 0012). */
export interface ActiveTaskTimer {
  id: string;
  taskId: string;
  projectId: string | null;
  taskTitle: string | null;
  startedAt: string;
  canStop: boolean;
}

export interface ProjectTimesheetRow {
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  user: UserRef | null;
  minutes: number;
}

export interface TimeEntry {
  id: string;
  taskId: string;
  /** Who logged it; null if that account was deleted. */
  user: UserRef | null;
  minutes: number;
  /** The day the work was done (YYYY-MM-DD). */
  spentOn: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * How long a task has spent in each status, derived from its status-change history
 * (decision record 0011). Real elapsed time, never an estimate.
 */
export interface TaskTimeInStatus {
  taskId: string;
  /** When these numbers were computed; the current status is counted up to this moment. */
  asOf: string;
  /** When the task entered its current status. */
  currentSince: string;
  /** Seconds per status, summed over every visit, in workflow order. Unvisited statuses are omitted. */
  totals: { status: TaskStatus; seconds: number }[];
  /** First move into In progress until completion. Null unless the task is done and was started. */
  cycleSeconds: number | null;
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

/** Delivery stages (decision record 0025 §2). Only Delivered stops taking new tasks. */
export const MILESTONE_STAGES = ['PLANNED', 'ACTIVE', 'CLIENT_REVIEW', 'DELIVERED'] as const;
export type MilestoneStatus = (typeof MILESTONE_STAGES)[number];

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  /** First move into Active (scope agreed); null until then. */
  startedAt: string | null;
  /** When it was delivered; null unless Delivered. */
  deliveredAt: string | null;
  /** Real counts of the milestone's non-deleted tasks; never an estimate. */
  taskCounts: { total: number; done: number; addedAfterStart: number };
  /** Acceptance criteria in display order. */
  criteria: MilestoneCriterion[];
  /** GitHub releases that deliver it (0026), newest first. Display only. */
  releases: LinkedMilestoneRelease[];
  /** 0028 §4: the client's latest approval on the sign-off page; null until approved. */
  clientApproval: { at: string; name: string | null; note: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

/** A published release of a repository connected to the project (decision record 0026). */
export interface GithubRelease {
  id: string;
  tagName: string;
  name: string | null;
  url: string;
  prerelease: boolean;
  publishedAt: string;
  /** `owner/name`. */
  repository: string;
}

export interface LinkedMilestoneRelease extends GithubRelease {
  /** `AUTO` when DevTrack linked it because its tag or name matched the milestone. */
  source: 'MANUAL' | 'AUTO';
}

/** One acceptance criterion: a checkable statement of what "done" means for a milestone. */
export interface MilestoneCriterion {
  id: string;
  milestoneId: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  doneBy: UserRef | null;
}

/** One line of a task's checklist (decision record 0018). */
export interface TaskChecklistItem {
  id: string;
  taskId: string;
  body: string;
  position: number;
  assignee: UserRef | null;
  done: boolean;
  doneAt: string | null;
  doneBy: UserRef | null;
  createdAt: string;
}

/** How a task relates to another, from this task's side (decision record 0020). */
export type TaskRelationKind = 'BLOCKS' | 'BLOCKED_BY' | 'RELATES';

/** A related task as listed on a task page. */
export interface RelatedTask {
  /** The relation's id, for removing it. */
  relationId: string;
  kind: TaskRelationKind;
  task: {
    id: string;
    key: string;
    title: string;
    status: TaskStatus;
    projectId: string;
    projectName: string;
  };
}

/** `GET /workspaces/:id/overview` (decision record 0027): undelivered milestones by stage. */
export interface WorkspaceOverview {
  sections: {
    stage: Exclude<MilestoneStatus, 'DELIVERED'>;
    projects: { project: { id: string; key: string; name: string }; milestones: Milestone[] }[];
  }[];
}

/** `GET /public/signoff/:token` (decision record 0028 §3): what the client's review page shows. */
export interface PublicSignoff {
  projectName: string;
  milestone: {
    name: string;
    description: string | null;
    dueDate: string | null;
    criteria: { text: string; done: boolean }[];
    releases: { tag: string; url: string }[];
    approvedAt: string | null;
  };
}

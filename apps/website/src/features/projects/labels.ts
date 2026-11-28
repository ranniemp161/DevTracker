import type {
  Milestone,
  MilestoneStatus,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '@devtrack/types';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  BLOCKED: 'Blocked',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const PRIORITY_TONE: Record<TaskPriority, 'neutral' | 'blue' | 'amber' | 'red'> = {
  LOW: 'neutral',
  MEDIUM: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

/** Board ordering within a column: priority first, then oldest first (M3 rule 8). */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

/** Milestone delivery stages (decision record 0025 §2). */
export const MILESTONE_STAGE_LABEL: Record<MilestoneStatus, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  CLIENT_REVIEW: 'Client review',
  DELIVERED: 'Delivered',
};

/** 0025 §4: an Active milestone with every task Done and every criterion ticked. */
export function isReadyForReview(m: Milestone): boolean {
  return (
    m.status === 'ACTIVE' &&
    m.taskCounts.total > 0 &&
    m.taskCounts.done === m.taskCounts.total &&
    m.criteria.every((c) => c.done)
  );
}

/** Milestones that take tasks (not Delivered, 0025 §2), soonest due first, undated last. */
export function openMilestones(milestones: Milestone[]): Milestone[] {
  return milestones
    .filter((m) => m.status !== 'DELIVERED')
    .sort((a, b) => {
      if (a.dueDate === b.dueDate) return a.name.localeCompare(b.name);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
}

/** Badge tone for each milestone stage. */
export const MILESTONE_STAGE_TONE: Record<MilestoneStatus, 'neutral' | 'blue' | 'amber' | 'green'> =
  {
    PLANNED: 'neutral',
    ACTIVE: 'blue',
    CLIENT_REVIEW: 'amber',
    DELIVERED: 'green',
  };

/** Calendar-date difference in days between a YYYY-MM-DD string and today (local). */
function daysUntil(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const target = Date.UTC(y!, m! - 1, d!);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** Text tone for a milestone due date: red when overdue, amber within two days. */
export function dueTone(iso: string, delivered: boolean) {
  if (delivered) return 'text-fg-muted';
  const days = daysUntil(iso);
  if (days < 0) return 'font-medium text-danger';
  if (days <= 2) return 'font-medium text-warning-fg';
  return 'text-fg-muted';
}

export function dueLabel(iso: string, delivered: boolean) {
  if (!delivered && daysUntil(iso) < 0) return `Overdue · ${formatDate(iso)}`;
  return `Due ${formatDate(iso)}`;
}

/** Badge tone for a project status (SPEC §2: blue for planning/active, green when completed). */
export function projectStatusTone(status: ProjectStatus): 'blue' | 'green' | 'neutral' {
  if (status === 'ACTIVE' || status === 'PLANNING') return 'blue';
  return status === 'COMPLETED' ? 'green' : 'neutral';
}

/** Elapsed time in its two largest units: `45m`, `3h 20m`, `2d 4h`. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'Under 1m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Effort in hours and minutes, the way it is typed: `45m`, `4h`, `4h 30m`. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // Dates are calendar dates (YYYY-MM-DD); format without time-zone shifts.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}

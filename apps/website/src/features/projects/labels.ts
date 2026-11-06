import type { ProjectStatus, TaskPriority, TaskStatus } from '@devtrack/types';

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

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // Dates are calendar dates (YYYY-MM-DD); format without time-zone shifts.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}

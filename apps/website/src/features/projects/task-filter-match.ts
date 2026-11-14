import type { Task } from '@devtrack/types';
import { parseTaskSearch, taskMatchesSearch } from '@devtrack/validators';

/** Board/List filters as they appear in the URL; an empty string means "any". */
export interface TaskFilters {
  status: string;
  priority: string;
  assigneeId: string;
  labelId: string;
  /** A milestone id, or `none` for tasks without a milestone. */
  milestoneId: string;
  /** Free-text search: title, description or task key (see `parseTaskSearch`). */
  q: string;
}

/** Board-side filtering. The List gets the same result from the API (`GET /projects/:id/tasks`). */
export function filterTask(task: Task, filters: TaskFilters, projectKey: string): boolean {
  if (filters.q) {
    const search = parseTaskSearch(filters.q, projectKey);
    if (search && !taskMatchesSearch(task, search)) return false;
  }
  if (filters.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.assigneeId) {
    if (filters.assigneeId === 'unassigned') {
      if (task.assignees.length > 0) return false;
    } else if (!task.assignees.some((a) => a.id === filters.assigneeId)) {
      return false;
    }
  }
  if (filters.labelId && !task.labels.some((l) => l.id === filters.labelId)) return false;
  if (filters.milestoneId) {
    if (
      filters.milestoneId === 'none'
        ? task.milestoneId !== null
        : task.milestoneId !== filters.milestoneId
    ) {
      return false;
    }
  }
  return true;
}

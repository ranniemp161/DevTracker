import { TASK_STATUSES, type TaskStatus } from '@devtrack/types';

/**
 * The List is "updating" while its rows still belong to an earlier query (a filter or the
 * search changed and the new page hasn't arrived). Refreshes of the same query, such as a
 * realtime update, don't count, so they never dim the table.
 */
export function isListUpdating(loadedQuery: string | null, currentQuery: string): boolean {
  return loadedQuery !== null && loadedQuery !== currentQuery;
}

/**
 * What the List announces once results arrive. With more pages to load, the total isn't known,
 * so it says "50+" instead of inventing a number.
 */
export function resultCountLabel(count: number, hasMore: boolean): string {
  if (count === 0) return 'No tasks match these filters.';
  if (hasMore) return `${count}+ tasks`;
  return count === 1 ? '1 task' : `${count} tasks`;
}

/** Visible label while the List updates. */
export function updatingLabel(searching: boolean): string {
  return searching ? 'Searching…' : 'Updating…';
}

/** `?group=status` groups the List by status; anything else lists tasks newest first. */
export type ListGrouping = 'none' | 'status';
export function parseListGrouping(value: string | null): ListGrouping {
  return value === 'status' ? 'status' : 'none';
}

/**
 * Status groups for loaded rows, which the API sends status by status (`sort=status`). Every
 * group but the last is complete; while more pages exist, the last one says "12+".
 */
export function groupByStatus<T extends { status: TaskStatus }>(
  rows: readonly T[],
  hasMore: boolean,
): { status: TaskStatus; tasks: T[]; countLabel: string }[] {
  const groups = TASK_STATUSES.map((status) => ({
    status,
    tasks: rows.filter((r) => r.status === status),
  })).filter((g) => g.tasks.length > 0);
  return groups.map((g, i) => ({
    ...g,
    countLabel: hasMore && i === groups.length - 1 ? `${g.tasks.length}+` : String(g.tasks.length),
  }));
}

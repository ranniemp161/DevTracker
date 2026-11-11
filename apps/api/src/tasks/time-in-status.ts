import { TASK_STATUSES, type TaskStatus, type TaskTimeInStatus } from '@devtrack/types';

export interface StatusChange {
  at: Date;
  to: TaskStatus;
}

export const isTaskStatus = (v: unknown): v is TaskStatus =>
  typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);

const seconds = (from: Date, to: Date) =>
  Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

/**
 * Walks a task's status history and totals the time spent in each status. The last status
 * is counted up to `now`. `changes` must be in chronological order (decision record 0011).
 */
export function timeInStatus(input: {
  createdAt: Date;
  initialStatus: TaskStatus;
  changes: StatusChange[];
  completedAt: Date | null;
  now: Date;
}): Omit<TaskTimeInStatus, 'taskId'> {
  const spent = new Map<TaskStatus, number>();
  let status = input.initialStatus;
  let since = input.createdAt;
  let startedAt = status === 'IN_PROGRESS' ? since : null;

  for (const change of input.changes) {
    spent.set(status, (spent.get(status) ?? 0) + seconds(since, change.at));
    status = change.to;
    since = change.at;
    if (status === 'IN_PROGRESS' && !startedAt) startedAt = since;
  }
  spent.set(status, (spent.get(status) ?? 0) + seconds(since, input.now));

  return {
    asOf: input.now.toISOString(),
    currentSince: since.toISOString(),
    totals: TASK_STATUSES.filter((s) => spent.has(s)).map((s) => ({
      status: s,
      seconds: spent.get(s)!,
    })),
    cycleSeconds:
      startedAt && input.completedAt && input.completedAt >= startedAt
        ? seconds(startedAt, input.completedAt)
        : null,
  };
}

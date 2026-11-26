import type { Task } from '@devtrack/types';

/** The part of a realtime event the board reacts to. */
export interface BoardEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** More tasks than this in one batch (e.g. a bulk edit) reload the whole board instead. */
export const MAX_TASKS_PER_REFRESH = 20;

export type TaskRefresh = { kind: 'all' } | { kind: 'tasks'; fetch: string[]; remove: string[] };

/**
 * What a batch of realtime events means for the board (#131). Task events name their task,
 * so only those tasks are fetched again, and deleted ones are simply removed. A reconnect
 * (`'all'`, events may have been missed), a pull request update (cards show CI state, and
 * the event doesn't say which tasks link the PR), an event without a task id, or a large
 * batch reloads everything, as before.
 */
export function planTaskRefresh(events: readonly BoardEvent[] | 'all'): TaskRefresh {
  if (events === 'all') return { kind: 'all' };
  const latest = new Map<string, 'fetch' | 'remove'>();
  for (const e of events) {
    const taskId = e.payload.taskId;
    if (!e.type.startsWith('task.') || typeof taskId !== 'string') return { kind: 'all' };
    latest.set(taskId, e.type === 'task.deleted' ? 'remove' : 'fetch');
  }
  if (latest.size > MAX_TASKS_PER_REFRESH) return { kind: 'all' };
  const fetch: string[] = [];
  const remove: string[] = [];
  for (const [id, action] of latest) (action === 'fetch' ? fetch : remove).push(id);
  return { kind: 'tasks', fetch, remove };
}

/**
 * Applies fetched tasks to the board's list. `fetched` maps each requested id to the task,
 * or `null` when it is gone (404). A task now in another project leaves this board. New
 * tasks go first; every untouched task stays the same object, so its card doesn't re-render.
 */
export function applyTaskRefresh(
  current: readonly Task[],
  projectId: string,
  remove: readonly string[],
  fetched: ReadonlyMap<string, Task | null>,
): Task[] {
  const gone = new Set(remove);
  const known = new Set(current.map((t) => t.id));
  const added: Task[] = [];
  for (const [id, task] of fetched) {
    if (!task || task.projectId !== projectId) gone.add(id);
    else if (!known.has(id)) added.push(task);
  }
  const kept = current
    .filter((t) => !gone.has(t.id))
    .map((t) => {
      const task = fetched.get(t.id);
      return task && !gone.has(t.id) ? task : t;
    });
  return [...added, ...kept];
}

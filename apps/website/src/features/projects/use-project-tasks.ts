'use client';

import type { Task } from '@devtrack/types';
import { useCallback, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from 'react';
import { fetchIntoCache, readCache, revalidate, subscribeCache, writeCache } from '@/lib/api-cache';
import { api, ApiError } from '@/lib/api';
import { useRealtimeEvents, type RealtimeEvent } from '@/lib/realtime';
import { applyTaskRefresh, planTaskRefresh } from './board-refresh';
import { loadAllTasks } from './load-all-tasks';

/**
 * Loads every live task of a project, for the Kanban board. Cached like `useApiQuery`:
 * returning to the board shows the tasks at once and refreshes them in the background.
 */
export function useProjectTasks(projectId: string) {
  // `#all` keeps this key apart from any single-page request for the same path.
  const key = `/projects/${projectId}/tasks#all`;
  const load = useMemo(() => () => loadAllTasks(projectId), [projectId]);
  const subscribe = useCallback((onChange: () => void) => subscribeCache(key, onChange), [key]);
  const entry = useSyncExternalStore(
    subscribe,
    () => readCache(key),
    () => undefined,
  );

  useEffect(() => {
    revalidate(key, load);
  }, [key, load]);

  const reload = useCallback(() => void fetchIntoCache(key, true, load), [key, load]);

  /** Optimistic updates go into the cache, so they survive leaving the board and coming back. */
  const setTasks = useCallback(
    (next: SetStateAction<Task[] | null>) => {
      const current = (readCache(key)?.data as Task[] | undefined) ?? null;
      writeCache(key, typeof next === 'function' ? next(current) : next);
    },
    [key],
  );

  // Live updates (M7, #131): a task event refetches only the tasks it names; a pull request
  // change (cards show linked PRs' CI state, 0015), a big batch or a reconnect reloads all.
  const refresh = useCallback(
    async (events: RealtimeEvent[] | 'all') => {
      const plan = planTaskRefresh(events);
      if (plan.kind === 'all' || !readCache(key)?.data) return reload();
      const fetched = new Map<string, Task | null>();
      try {
        await Promise.all(
          plan.fetch.map(async (id) => {
            try {
              fetched.set(id, (await api<{ task: Task }>(`/tasks/${id}`)).task);
            } catch (err) {
              if (err instanceof ApiError && err.status === 404) fetched.set(id, null);
              else throw err;
            }
          }),
        );
      } catch {
        return reload(); // a failed single fetch falls back to the full reload
      }
      // Applied to the list as it is now: optimistic moves made meanwhile are kept.
      const current = readCache(key)?.data as Task[] | undefined;
      if (current) writeCache(key, applyTaskRefresh(current, projectId, plan.remove, fetched));
    },
    [key, projectId, reload],
  );
  useRealtimeEvents(
    (e) =>
      e.projectId === projectId &&
      (e.type.startsWith('task.') || e.type === 'github.pull_request.updated'),
    (events) => void refresh(events),
  );

  const tasks = useMemo(() => (entry?.data as Task[] | null | undefined) ?? null, [entry]);
  return { tasks, setTasks, error: entry?.error?.message ?? null, reload };
}

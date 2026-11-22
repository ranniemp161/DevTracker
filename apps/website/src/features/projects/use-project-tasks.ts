'use client';

import type { Task } from '@devtrack/types';
import { useCallback, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from 'react';
import { apiPage } from '@/lib/api';
import { fetchIntoCache, readCache, revalidate, subscribeCache, writeCache } from '@/lib/api-cache';
import { useRealtimeRefresh } from '@/lib/realtime';

/** Every live task of a project, all pages. */
async function loadAllTasks(projectId: string): Promise<Task[]> {
  const all: Task[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await apiPage<Task>(`/projects/${projectId}/tasks?limit=200${query}`);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

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

  // Live updates (M7): any task change in this project refetches the board, and so does a
  // pull request change, since cards show the CI state of linked PRs (0015).
  useRealtimeRefresh(
    (e) =>
      e.projectId === projectId &&
      (e.type.startsWith('task.') || e.type === 'github.pull_request.updated'),
    reload,
  );

  const tasks = useMemo(() => (entry?.data as Task[] | null | undefined) ?? null, [entry]);
  return { tasks, setTasks, error: entry?.error?.message ?? null, reload };
}

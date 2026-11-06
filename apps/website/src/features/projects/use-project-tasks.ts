'use client';

import type { Task } from '@devtrack/types';
import { useCallback, useEffect, useState } from 'react';
import { apiPage, ApiError } from '@/lib/api';

/** Loads every live task of a project (all pages), for the Kanban board. */
export function useProjectTasks(projectId: string) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: Task[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        const page = await apiPage<Task>(`/projects/${projectId}/tasks?limit=200${query}`);
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && !cancelled);
      return all;
    })().then(
      (all) => {
        if (cancelled) return;
        setTasks(all);
        setError(null);
      },
      (err: unknown) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load tasks.'),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { tasks, setTasks, error, reload };
}

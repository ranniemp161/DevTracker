import { TASK_STATUSES, type Task } from '@devtrack/types';
import { apiPage } from '../../lib/api';

type FetchPage = (path: string) => Promise<{ items: Task[]; nextCursor: string | null }>;

const PAGE = 200;

/**
 * Every live task of a project, for the Kanban board (#128).
 *
 * A project that fits in one page takes one request, as before. A larger one used to take
 * one round per 200 tasks; now the rest is requested for every status at once, so it takes
 * one extra round. This works because the default (`number`) cursor means "tasks numbered
 * below n", which combines with a status filter, so each status continues from the first
 * page's cursor without repeating a task. A status with more than 200 of the rest follows
 * its own cursor. If any request fails the whole load fails, so the board never shows part
 * of a project.
 */
export async function loadAllTasks(
  projectId: string,
  fetchPage: FetchPage = apiPage<Task>,
): Promise<Task[]> {
  const base = `/projects/${projectId}/tasks`;
  const first = await fetchPage(`${base}?limit=${PAGE}`);
  if (!first.nextCursor) return first.items;
  const after = first.nextCursor;
  const rest = await Promise.all(
    TASK_STATUSES.map(async (status) => {
      const tasks: Task[] = [];
      let cursor: string | null = after;
      while (cursor) {
        const page = await fetchPage(
          `${base}?status=${status}&limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`,
        );
        tasks.push(...page.items);
        cursor = page.nextCursor;
      }
      return tasks;
    }),
  );
  return [...first.items, ...rest.flat()];
}

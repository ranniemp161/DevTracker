import { TASK_STATUSES, type Task } from '@devtrack/types';
import { apiPage } from '../../lib/api';

type FetchPage = (path: string) => Promise<{ items: Task[]; nextCursor: string | null }>;

/**
 * Every live task of a project, for the Kanban board. One request per status, all at once,
 * so a board of a few hundred tasks loads in one round instead of one round per 200 tasks
 * (#128). A status with more than 200 tasks follows its own cursor. If any request fails the
 * whole load fails, so the board never shows part of a project.
 */
export async function loadAllTasks(
  projectId: string,
  fetchPage: FetchPage = apiPage<Task>,
): Promise<Task[]> {
  const columns = await Promise.all(
    TASK_STATUSES.map(async (status) => {
      const tasks: Task[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        const page = await fetchPage(
          `/projects/${projectId}/tasks?status=${status}&limit=200${query}`,
        );
        tasks.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return tasks;
    }),
  );
  return columns.flat();
}

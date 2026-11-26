import { TASK_STATUSES, type Task } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { loadAllTasks } from './load-all-tasks';

const task = (id: string, status: Task['status']) => ({ id, status }) as Task;

describe('loadAllTasks', () => {
  it('asks for every status at once instead of one page after another', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = loadAllTasks('p1', async (path) => {
      started.push(path);
      await gate;
      return { items: [], nextCursor: null };
    });
    await Promise.resolve();
    // Every status was requested before any response came back.
    expect(started).toEqual(TASK_STATUSES.map((s) => `/projects/p1/tasks?status=${s}&limit=200`));
    release();
    await expect(load).resolves.toEqual([]);
  });

  it('follows the cursor of a status with more than one page, and keeps every task', async () => {
    const pages: Record<string, { items: Task[]; nextCursor: string | null }> = {
      '/projects/p1/tasks?status=TODO&limit=200': {
        items: [task('a', 'TODO')],
        nextCursor: 'c 1',
      },
      '/projects/p1/tasks?status=TODO&limit=200&cursor=c%201': {
        items: [task('b', 'TODO')],
        nextCursor: null,
      },
      '/projects/p1/tasks?status=DONE&limit=200': { items: [task('c', 'DONE')], nextCursor: null },
    };
    const tasks = await loadAllTasks(
      'p1',
      async (path) => pages[path] ?? { items: [], nextCursor: null },
    );
    expect(tasks.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('fails when any status fails, so the board never shows a partial list', async () => {
    await expect(
      loadAllTasks('p1', async (path) => {
        if (path.includes('BLOCKED')) throw new Error('boom');
        return { items: [], nextCursor: null };
      }),
    ).rejects.toThrow('boom');
  });
});

import { TASK_STATUSES, type Task } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { loadAllTasks } from './load-all-tasks';

type PageResult = { items: Task[]; nextCursor: string | null };
const task = (id: string, status: Task['status']) => ({ id, status }) as Task;
const empty: PageResult = { items: [], nextCursor: null };

describe('loadAllTasks', () => {
  it('makes one request when the project fits in one page', async () => {
    const paths: string[] = [];
    const tasks = await loadAllTasks('p1', async (path) => {
      paths.push(path);
      return { items: [task('a', 'TODO')], nextCursor: null };
    });
    expect(paths).toEqual(['/projects/p1/tasks?limit=200']);
    expect(tasks.map((t) => t.id)).toEqual(['a']);
  });

  it('loads the rest of a large project for every status at once, from the first cursor', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = loadAllTasks('p1', async (path) => {
      started.push(path);
      if (path === '/projects/p1/tasks?limit=200')
        return { items: [task('first', 'TODO')], nextCursor: 'c1' };
      await gate;
      return path.includes('status=DONE')
        ? { items: [task('older', 'DONE')], nextCursor: null }
        : empty;
    });
    await new Promise((r) => setTimeout(r, 0));
    // Every status was requested before any of them answered: one extra round, not one per page.
    expect(started.slice(1)).toEqual(
      TASK_STATUSES.map((s) => `/projects/p1/tasks?status=${s}&limit=200&cursor=c1`),
    );
    release();
    expect((await load).map((t) => t.id).sort()).toEqual(['first', 'older']);
  });

  it('follows the cursor of a status with more than one page', async () => {
    const pages: Record<string, PageResult> = {
      '/projects/p1/tasks?limit=200': { items: [task('a', 'TODO')], nextCursor: 'c1' },
      '/projects/p1/tasks?status=TODO&limit=200&cursor=c1': {
        items: [task('b', 'TODO')],
        nextCursor: 'c 2',
      },
      '/projects/p1/tasks?status=TODO&limit=200&cursor=c%202': {
        items: [task('c', 'TODO')],
        nextCursor: null,
      },
    };
    const tasks = await loadAllTasks('p1', async (path) => pages[path] ?? empty);
    expect(tasks.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('fails when any request fails, so the board never shows part of a project', async () => {
    await expect(
      loadAllTasks('p1', async (path) => {
        if (!path.includes('status=')) return { items: [], nextCursor: 'c1' };
        if (path.includes('BLOCKED')) throw new Error('boom');
        return empty;
      }),
    ).rejects.toThrow('boom');
  });
});

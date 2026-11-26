import type { Task } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { applyTaskRefresh, planTaskRefresh, type BoardEvent } from './board-refresh';

const ev = (type: string, taskId?: string): BoardEvent => ({
  type,
  payload: taskId ? { taskId } : {},
});
const t = (id: string, title = id, projectId = 'p1') => ({ id, title, projectId }) as Task;

describe('planTaskRefresh', () => {
  it('fetches the tasks that were created or updated, once each', () => {
    expect(
      planTaskRefresh([ev('task.updated', 'a'), ev('task.created', 'b'), ev('task.updated', 'a')]),
    ).toEqual({ kind: 'tasks', fetch: ['a', 'b'], remove: [] });
  });

  it('removes deleted tasks without a request; the latest event for a task wins', () => {
    expect(
      planTaskRefresh([ev('task.updated', 'a'), ev('task.deleted', 'a'), ev('task.deleted', 'b')]),
    ).toEqual({ kind: 'tasks', fetch: [], remove: ['a', 'b'] });
    expect(planTaskRefresh([ev('task.deleted', 'a'), ev('task.created', 'a')])).toEqual({
      kind: 'tasks',
      fetch: ['a'],
      remove: [],
    });
  });

  it('reloads the whole board for a reconnect, a PR update, an event without a task id, or a big batch', () => {
    expect(planTaskRefresh('all')).toEqual({ kind: 'all' });
    expect(planTaskRefresh([ev('task.updated', 'a'), ev('github.pull_request.updated')])).toEqual({
      kind: 'all',
    });
    expect(planTaskRefresh([ev('task.updated')])).toEqual({ kind: 'all' });
    const many = Array.from({ length: 21 }, (_, i) => ev('task.updated', `t${i}`));
    expect(planTaskRefresh(many)).toEqual({ kind: 'all' });
    expect(planTaskRefresh(many.slice(0, 20))).toMatchObject({ kind: 'tasks' });
  });
});

describe('applyTaskRefresh', () => {
  const board = [t('a'), t('b'), t('c')];

  it('replaces changed cards in place and puts new ones first', () => {
    const next = applyTaskRefresh(
      board,
      'p1',
      [],
      new Map([
        ['b', t('b', 'B2')],
        ['n', t('n')],
      ]),
    );
    expect(next.map((x) => `${x.id}:${x.title}`)).toEqual(['n:n', 'a:a', 'b:B2', 'c:c']);
  });

  it('removes deleted cards, cards that are gone (404) and cards moved to another project', () => {
    const next = applyTaskRefresh(
      board,
      'p1',
      ['a'],
      new Map<string, Task | null>([
        ['b', null],
        ['c', t('c', 'c', 'other')],
      ]),
    );
    expect(next).toEqual([]);
  });

  it('keeps the other cards as the same objects, so memoized cards do not re-render', () => {
    const next = applyTaskRefresh(board, 'p1', [], new Map([['b', t('b', 'B2')]]));
    expect(next[0]).toBe(board[0]);
    expect(next[2]).toBe(board[2]);
  });
});

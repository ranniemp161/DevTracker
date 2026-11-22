import type { WorkspaceSearchResponse } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { moveActive, searchItems, searchPath } from './search-results';

const project = { id: 'p1', key: 'WEB', name: 'Website', status: 'ACTIVE' as const };
const response: WorkspaceSearchResponse = {
  tasks: [
    { id: 't1', key: 'WEB-1', title: 'Login', status: 'TODO', priority: 'HIGH', project },
    { id: 't2', key: 'WEB-2', title: 'Logout', status: 'DONE', priority: 'LOW', project },
  ],
  projects: [project],
  hasMoreTasks: false,
};

describe('searchItems', () => {
  it('lists tasks, then projects, each with where it opens', () => {
    expect(searchItems(response).map((i) => [i.id, i.href])).toEqual([
      ['task-t1', '/projects/p1/tasks/t1'],
      ['task-t2', '/projects/p1/tasks/t2'],
      ['project-p1', '/projects/p1'],
    ]);
    expect(searchItems(undefined)).toEqual([]);
  });
});

describe('moveActive', () => {
  it('moves and wraps at both ends', () => {
    expect(moveActive(-1, 1, 3)).toBe(0);
    expect(moveActive(-1, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(1, 1, 3)).toBe(2);
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});

describe('searchPath', () => {
  it('encodes the query and skips empty searches', () => {
    expect(searchPath('w1', ' 50% off ')).toBe('/workspaces/w1/search?q=50%25%20off');
    expect(searchPath('w1', '   ')).toBeNull();
    expect(searchPath('', 'x')).toBeNull();
  });
});

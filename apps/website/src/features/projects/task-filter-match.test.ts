import type { Task } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { filterTask, type TaskFilters } from './task-filter-match';

const none: TaskFilters = {
  status: '',
  priority: '',
  assigneeId: '',
  labelId: '',
  milestoneId: '',
  q: '',
};

function task(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    projectId: 'p1',
    number: 7,
    key: 'DEV-7',
    title: 'Fix login redirect',
    description: 'Happens after the OAuth callback',
    status: 'TODO',
    priority: 'MEDIUM',
    reporter: null,
    assignees: [],
    labels: [],
    dueDate: null,
    milestoneId: null,
    estimateMinutes: null,
    loggedMinutes: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as Task;
}

const matches = (q: string, t = task({})) => filterTask(t, { ...none, q }, 'DEV');

describe('filterTask search', () => {
  it('passes every task when the search is empty or blank', () => {
    expect(matches('')).toBe(true);
    expect(matches('   ')).toBe(true);
  });

  it('matches title and description, ignoring case', () => {
    expect(matches('LOGIN')).toBe(true);
    expect(matches('oauth')).toBe(true);
    expect(matches('signup')).toBe(false);
  });

  it('matches the task key, #number or a bare number', () => {
    expect(matches('DEV-7')).toBe(true);
    expect(matches('dev-7')).toBe(true);
    expect(matches('#7')).toBe(true);
    expect(matches('7')).toBe(true);
    expect(matches('DEV-8')).toBe(false);
  });

  it('treats another project key as plain text', () => {
    expect(matches('API-7')).toBe(false);
    expect(matches('API-7', task({ title: 'Port API-7 fix' }))).toBe(true);
  });

  it('combines with the other filters', () => {
    const t = task({ status: 'DONE' });
    expect(filterTask(t, { ...none, q: 'login', status: 'DONE' }, 'DEV')).toBe(true);
    expect(filterTask(t, { ...none, q: 'login', status: 'TODO' }, 'DEV')).toBe(false);
  });
});

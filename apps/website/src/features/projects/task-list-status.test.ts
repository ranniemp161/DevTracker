import { describe, expect, it } from 'vitest';
import {
  groupByStatus,
  isListUpdating,
  parseListGrouping,
  resultCountLabel,
  updatingLabel,
} from './task-list-status';

describe('isListUpdating', () => {
  it('is false before the first load and when rows match the query', () => {
    expect(isListUpdating(null, '/p/tasks?limit=50')).toBe(false);
    expect(isListUpdating('/p/tasks?limit=50', '/p/tasks?limit=50')).toBe(false);
  });

  it('is true while rows belong to an earlier query', () => {
    expect(isListUpdating('/p/tasks?limit=50', '/p/tasks?q=bug&limit=50')).toBe(true);
  });
});

describe('resultCountLabel', () => {
  it('counts loaded tasks, and never claims a total when more pages exist', () => {
    expect(resultCountLabel(0, false)).toBe('No tasks match these filters.');
    expect(resultCountLabel(1, false)).toBe('1 task');
    expect(resultCountLabel(3, false)).toBe('3 tasks');
    expect(resultCountLabel(50, true)).toBe('50+ tasks');
  });
});

describe('updatingLabel', () => {
  it('says Searching when a search is active', () => {
    expect(updatingLabel(true)).toBe('Searching…');
    expect(updatingLabel(false)).toBe('Updating…');
  });
});

describe('grouping', () => {
  it('reads ?group=status, defaulting to none', () => {
    expect(parseListGrouping('status')).toBe('status');
    expect(parseListGrouping(null)).toBe('none');
    expect(parseListGrouping('priority')).toBe('none');
  });

  const rows = [
    { id: 'a', status: 'TODO' as const },
    { id: 'b', status: 'BACKLOG' as const },
    { id: 'c', status: 'TODO' as const },
    { id: 'd', status: 'DONE' as const },
  ];

  it('groups in Board order, skipping empty statuses', () => {
    expect(groupByStatus(rows, false).map((g) => [g.status, g.tasks.map((t) => t.id)])).toEqual([
      ['BACKLOG', ['b']],
      ['TODO', ['a', 'c']],
      ['DONE', ['d']],
    ]);
  });

  it('marks only the last group as partial while more pages exist', () => {
    expect(groupByStatus(rows, true).map((g) => g.countLabel)).toEqual(['1', '2', '1+']);
    expect(groupByStatus(rows, false).map((g) => g.countLabel)).toEqual(['1', '2', '1']);
  });
});

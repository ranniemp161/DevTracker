import { describe, expect, it } from 'vitest';
import { dueGroup, groupByDue, localDate } from './my-tasks-groups';

const today = '2026-11-14';

describe('dueGroup', () => {
  it('sorts due dates into sections relative to today', () => {
    expect(dueGroup(null, today)).toBe('none');
    expect(dueGroup('2026-11-13', today)).toBe('overdue');
    expect(dueGroup('2026-11-14', today)).toBe('today');
    expect(dueGroup('2026-11-15', today)).toBe('week');
    expect(dueGroup('2026-11-21', today)).toBe('week');
    expect(dueGroup('2026-11-22', today)).toBe('later');
  });

  it('handles month and year boundaries', () => {
    expect(dueGroup('2027-01-03', '2026-12-30')).toBe('week');
    expect(dueGroup('2026-12-01', '2026-11-30')).toBe('week');
  });
});

describe('groupByDue', () => {
  it('keeps section order and the order within each section, skipping empty ones', () => {
    const tasks = [
      { id: 'a', dueDate: '2026-11-14' },
      { id: 'b', dueDate: '2026-11-10' },
      { id: 'c', dueDate: null },
      { id: 'd', dueDate: '2026-11-14' },
    ];
    expect(groupByDue(tasks, today).map((g) => [g.group, g.tasks.map((t) => t.id)])).toEqual([
      ['overdue', ['b']],
      ['today', ['a', 'd']],
      ['none', ['c']],
    ]);
  });
});

describe('localDate', () => {
  it('formats the local calendar date', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

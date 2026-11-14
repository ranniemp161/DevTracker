import { describe, expect, it } from 'vitest';
import { isListUpdating, resultCountLabel, updatingLabel } from './task-list-status';

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

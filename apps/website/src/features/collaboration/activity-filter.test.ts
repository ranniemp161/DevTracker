import { describe, expect, it } from 'vitest';
import { ACTIVITY_FILTERS, parseActivityCategory } from './activity-filter';

describe('activity filters', () => {
  it('reads known categories and falls back to All', () => {
    expect(parseActivityCategory('repository')).toBe('repository');
    expect(parseActivityCategory(null)).toBeNull();
    expect(parseActivityCategory('nope')).toBeNull();
  });

  it('offers All first, then the SPEC chips', () => {
    expect(ACTIVITY_FILTERS.map((f) => f.label)).toEqual([
      'All',
      'Tasks',
      'Comments',
      'Repository',
      'Members',
    ]);
  });
});

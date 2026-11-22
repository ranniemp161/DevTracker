import { describe, expect, it } from 'vitest';
import { parseWorkspaceSearch, WORKSPACE_SEARCH_MAX_LENGTH } from './search.js';

describe('parseWorkspaceSearch', () => {
  it.each([
    ['dev-12', { key: { projectKey: 'DEV', number: 12 }, number: null, text: 'dev-12' }],
    ['#7', { key: null, number: 7, text: null }],
    ['42', { key: null, number: 42, text: '42' }],
    ['  login bug ', { key: null, number: null, text: 'login bug' }],
    ['1DEV-2', { key: null, number: null, text: '1DEV-2' }],
  ])('parses %j', (q, expected) => {
    expect(parseWorkspaceSearch(q)).toEqual(expected);
  });

  it('returns null for an empty search and caps the length', () => {
    expect(parseWorkspaceSearch('   ')).toBeNull();
    expect(parseWorkspaceSearch('x'.repeat(500))!.text).toHaveLength(WORKSPACE_SEARCH_MAX_LENGTH);
  });
});

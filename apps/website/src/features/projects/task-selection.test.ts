import { describe, expect, it } from 'vitest';
import { selectionState, toggleAll, toggleOne, updatedLabel } from './task-selection';

describe('task selection', () => {
  it('toggles one task', () => {
    expect([...toggleOne(new Set(['a']), 'b')]).toEqual(['a', 'b']);
    expect([...toggleOne(new Set(['a', 'b']), 'a')]).toEqual(['b']);
  });

  it('reports none, some or all of the loaded rows', () => {
    expect(selectionState(new Set(), ['a', 'b'])).toBe('none');
    expect(selectionState(new Set(['a']), ['a', 'b'])).toBe('some');
    expect(selectionState(new Set(['a', 'b']), ['a', 'b'])).toBe('all');
    expect(selectionState(new Set(['x']), ['a', 'b'])).toBe('none');
  });

  it('the header box selects all loaded rows, or clears when all are selected', () => {
    expect([...toggleAll(new Set(['a']), ['a', 'b'])]).toEqual(['a', 'b']);
    expect([...toggleAll(new Set(['a', 'b']), ['a', 'b'])]).toEqual([]);
  });

  it('confirms how many tasks changed', () => {
    expect(updatedLabel(1)).toBe('Updated 1 task');
    expect(updatedLabel(7)).toBe('Updated 7 tasks');
  });
});

/** Selected task ids in the List. Plain functions so the rules are easy to test. */
export type Selection = ReadonlySet<string>;

export function toggleOne(selected: Selection, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The header box: selects every loaded row, or clears them when all are already selected. */
export function toggleAll(selected: Selection, loadedIds: readonly string[]): Set<string> {
  return selectionState(selected, loadedIds) === 'all' ? new Set() : new Set(loadedIds);
}

export function selectionState(
  selected: Selection,
  loadedIds: readonly string[],
): 'none' | 'some' | 'all' {
  const count = loadedIds.filter((id) => selected.has(id)).length;
  if (count === 0) return 'none';
  return count === loadedIds.length ? 'all' : 'some';
}

export function updatedLabel(count: number): string {
  return count === 1 ? 'Updated 1 task' : `Updated ${count} tasks`;
}

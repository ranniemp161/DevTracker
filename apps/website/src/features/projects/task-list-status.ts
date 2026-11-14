/**
 * The List is "updating" while its rows still belong to an earlier query (a filter or the
 * search changed and the new page hasn't arrived). Refreshes of the same query, such as a
 * realtime update, don't count, so they never dim the table.
 */
export function isListUpdating(loadedQuery: string | null, currentQuery: string): boolean {
  return loadedQuery !== null && loadedQuery !== currentQuery;
}

/**
 * What the List announces once results arrive. With more pages to load, the total isn't known,
 * so it says "50+" instead of inventing a number.
 */
export function resultCountLabel(count: number, hasMore: boolean): string {
  if (count === 0) return 'No tasks match these filters.';
  if (hasMore) return `${count}+ tasks`;
  return count === 1 ? '1 task' : `${count} tasks`;
}

/** Visible label while the List updates. */
export function updatingLabel(searching: boolean): string {
  return searching ? 'Searching…' : 'Updating…';
}

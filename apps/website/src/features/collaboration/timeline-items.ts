import type { TimelineItem } from '@devtrack/types';

export type TimelineFilter = 'all' | 'comments';

/** `?activity=comments` shows comments only; anything else shows everything. */
export function parseTimelineFilter(value: string | null): TimelineFilter {
  return value === 'comments' ? 'comments' : 'all';
}

/** Comments and activity entries have separate id spaces, so the key includes the kind. */
export function timelineKey(item: TimelineItem): string {
  return item.kind === 'comment' ? `comment:${item.comment.id}` : `activity:${item.entry.id}`;
}

/**
 * Appends `incoming` (the next page, or a new comment) without repeating anything already
 * shown. An item that arrives again replaces the shown copy, e.g. an edited comment.
 */
export function appendTimeline(
  shown: readonly TimelineItem[],
  incoming: readonly TimelineItem[],
): TimelineItem[] {
  const fresh = new Map(incoming.map((i) => [timelineKey(i), i]));
  const updated = shown.map((i) => fresh.get(timelineKey(i)) ?? i);
  const known = new Set(shown.map(timelineKey));
  return [...updated, ...incoming.filter((i) => !known.has(timelineKey(i)))];
}

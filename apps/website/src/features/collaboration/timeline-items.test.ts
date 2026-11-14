import type { ActivityEntry, Comment, TimelineItem } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { appendTimeline, parseTimelineFilter, timelineKey } from './timeline-items';

const comment = (id: string, body = 'Hi'): TimelineItem => ({
  kind: 'comment',
  comment: { id, body } as Comment,
});
const activity = (id: string): TimelineItem => ({
  kind: 'activity',
  entry: { id } as ActivityEntry,
});

describe('parseTimelineFilter', () => {
  it('defaults to all', () => {
    expect(parseTimelineFilter(null)).toBe('all');
    expect(parseTimelineFilter('nope')).toBe('all');
    expect(parseTimelineFilter('comments')).toBe('comments');
  });
});

describe('appendTimeline', () => {
  it('keys comments and activity separately, even with equal ids', () => {
    expect(timelineKey(comment('x'))).not.toBe(timelineKey(activity('x')));
  });

  it('appends new items in order and skips ones already shown', () => {
    const shown = [activity('a'), comment('c1')];
    const result = appendTimeline(shown, [comment('c1'), activity('b'), comment('c2')]);
    expect(result.map(timelineKey)).toEqual([
      'activity:a',
      'comment:c1',
      'activity:b',
      'comment:c2',
    ]);
  });

  it('replaces a shown item with its newer copy in place', () => {
    const result = appendTimeline([comment('c1', 'old'), activity('a')], [comment('c1', 'new')]);
    expect(result.map((i) => (i.kind === 'comment' ? i.comment.body : i.entry.id))).toEqual([
      'new',
      'a',
    ]);
  });
});

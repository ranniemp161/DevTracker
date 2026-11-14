import type { ActivityEntry } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { activityKind } from './activity-kind';

const entry = (action: string, metadata: Record<string, unknown> = {}) =>
  ({ action, metadata }) as unknown as ActivityEntry;

describe('activityKind', () => {
  it.each([
    ['comment.created', 'comment'],
    ['comment.deleted', 'comment'],
    ['pull_request.merged', 'repo'],
    ['repository.pushed', 'repo'],
    ['project.repository_connected', 'repo'],
    ['project.member_added', 'member'],
    ['project.member_removed', 'member'],
    ['project.created', 'create'],
    ['project.archived', 'other'],
    ['task.created', 'create'],
    ['task.assigned', 'assign'],
    ['task.unlabeled', 'label'],
    ['task.time_logged', 'other'],
    ['milestone.completed', 'other'],
  ])('%s → %s', (action, kind) => {
    expect(activityKind(entry(action))).toBe(kind);
  });

  it('marks a status change, but not other field edits, as status', () => {
    expect(
      activityKind(entry('task.updated', { changes: { status: { from: 'TODO', to: 'DONE' } } })),
    ).toBe('status');
    expect(
      activityKind(entry('task.updated', { changes: { title: { from: 'a', to: 'b' } } })),
    ).toBe('other');
  });
});

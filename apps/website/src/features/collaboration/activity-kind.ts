import type { ActivityEntry } from '@devtrack/types';

/** Icon-circle kinds on the Activity page (SPEC §5; tints in tokens.css `--dt-activity-*`). */
export type ActivityKind =
  'status' | 'comment' | 'repo' | 'member' | 'assign' | 'label' | 'create' | 'other';

export function activityKind(entry: ActivityEntry): ActivityKind {
  const [entity, action] = entry.action.split('.') as [string, string];
  if (entity === 'comment') return 'comment';
  if (entity === 'pull_request' || entity === 'repository') return 'repo';
  if (entity === 'project') {
    if (action === 'member_added' || action === 'member_removed') return 'member';
    if (action === 'repository_connected' || action === 'repository_disconnected') return 'repo';
    if (action === 'created') return 'create';
    return 'other';
  }
  if (entity === 'task') {
    if (action === 'created') return 'create';
    if (action === 'assigned' || action === 'unassigned') return 'assign';
    if (action === 'labeled' || action === 'unlabeled') return 'label';
    if (action === 'updated') {
      const changes = (entry.metadata as { changes?: Record<string, unknown> }).changes ?? {};
      if ('status' in changes) return 'status';
    }
  }
  return 'other';
}

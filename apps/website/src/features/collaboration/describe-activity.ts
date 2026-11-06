import type { ActivityEntry, TaskPriority, TaskStatus } from '@devtrack/types';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from '../projects/labels';

type Change = { from?: unknown; to?: unknown; changed?: boolean };

const FIELD_LABEL: Record<string, string> = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  dueDate: 'due date',
  description: 'description',
};

function value(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (field === 'status') return TASK_STATUS_LABEL[v as TaskStatus] ?? String(v);
  if (field === 'priority') return PRIORITY_LABEL[v as TaskPriority] ?? String(v);
  return String(v);
}

/** Human-readable sentence for an activity entry (without the actor or the task key). */
export function describeActivity(entry: ActivityEntry): string {
  const m = entry.metadata as Record<string, unknown>;
  const user = (m.user as { username?: string } | null)?.username;
  const label = (m.label as { name?: string } | null)?.name;
  switch (entry.action) {
    case 'task.created':
      return 'created the task';
    case 'task.updated': {
      const changes = Object.entries((m.changes ?? {}) as Record<string, Change>).map(
        ([field, c]) =>
          c.changed
            ? `edited the ${FIELD_LABEL[field] ?? field}`
            : `changed ${FIELD_LABEL[field] ?? field} from ${value(field, c.from)} to ${value(field, c.to)}`,
      );
      return changes.join(', ') || 'updated the task';
    }
    case 'task.deleted':
      return 'deleted the task';
    case 'task.assigned':
      return `assigned @${user ?? 'someone'}`;
    case 'task.unassigned':
      return `unassigned @${user ?? 'someone'}`;
    case 'task.labeled':
      return `added label "${label ?? '?'}"`;
    case 'task.unlabeled':
      return `removed label "${label ?? '?'}"`;
    case 'comment.created':
      return 'commented';
    case 'comment.deleted':
      return m.moderated ? 'removed a comment' : 'deleted a comment';
    case 'project.created':
      return `created project ${String(m.key ?? '')}`;
    case 'project.updated':
      return `updated project ${((m.fields as string[]) ?? []).join(', ')}`;
    case 'project.archived':
      return 'archived the project';
    case 'project.member_added':
      return `added @${user ?? 'someone'} to the project`;
    case 'project.member_removed':
      return `removed @${user ?? 'someone'} from the project`;
    case 'project.repository_connected':
      return `connected repository ${repoName(m)}`;
    case 'project.repository_disconnected':
      return `disconnected repository ${repoName(m)}`;
    case 'github_installation.installed':
      return `installed the GitHub App on ${String(m.account ?? 'an account')}`;
    case 'milestone.completed':
      return `completed milestone "${String(m.name ?? '')}"`;
    default:
      return entry.action;
  }
}

function repoName(m: Record<string, unknown>): string {
  return (m.repository as { fullName?: string } | null)?.fullName ?? 'a repository';
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 604800) return rtf.format(-Math.round(seconds / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

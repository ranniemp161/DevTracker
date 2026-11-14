'use client';

import type { ActivityEntry } from '@devtrack/types';
import type { ActivityCategory } from '@devtrack/validators';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BranchIcon,
  ChatIcon,
  PlusIcon,
  StatusChangeIcon,
  TagIcon,
  UserIcon,
  UserPlusIcon,
} from '@/components/icons';
import { Alert, Button } from '@/components/ui';
import { apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { activityKind, type ActivityKind } from './activity-kind';
import { describeActivity, timeAgo } from './describe-activity';

/** Newest-first activity list with "Load more". Pass `taskId` for a single task's history. */
export function ActivityFeed({
  projectId,
  taskId,
  limit = 30,
  refreshKey,
  groupByDay = false,
  category,
  emptyMessage = 'No activity yet.',
}: {
  projectId: string;
  taskId?: string;
  limit?: number;
  /** Change to re-fetch (e.g. after the task is edited). */
  refreshKey?: unknown;
  /** Show "Today", "Yesterday" and date headings between entries. */
  groupByDay?: boolean;
  /** Server-side filter (Activity page chips); omitted means all activity. */
  category?: ActivityCategory;
  emptyMessage?: string;
}) {
  const base = `/projects/${projectId}/activity?limit=${limit}${taskId ? `&taskId=${taskId}` : ''}${
    category ? `&category=${category}` : ''
  }`;
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Live updates (M7): new entries for this project (or this task).
  useRealtimeRefresh(
    (e) =>
      e.type === 'activity.created' &&
      e.projectId === projectId &&
      (!taskId || e.payload.taskId === taskId),
    () => setVersion((v) => v + 1),
  );

  useEffect(() => {
    let cancelled = false;
    apiPage<ActivityEntry>(base).then(
      (page) => {
        if (cancelled) return;
        setEntries(page.items);
        setCursor(page.nextCursor);
        setError(null);
      },
      (err: unknown) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load activity.'),
    );
    return () => {
      cancelled = true;
    };
  }, [base, refreshKey, version]);

  async function loadMore() {
    if (!cursor) return;
    try {
      const page = await apiPage<ActivityEntry>(`${base}&cursor=${encodeURIComponent(cursor)}`);
      setEntries((e) => [...(e ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more activity.');
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!entries) return <p className="text-sm text-fg-subtle">Loading activity…</p>;
  if (entries.length === 0) return <p className="text-sm text-fg-subtle">{emptyMessage}</p>;

  const groups = groupByDay ? groupEntries(entries) : [{ label: '', items: entries }];

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label || undefined} className="space-y-3">
          {group.label ? (
            <h3 className="border-b border-line-subtle pb-2 text-label font-semibold text-fg-muted">
              {group.label}
            </h3>
          ) : null}
          {((items) => (
            <ol className="divide-y divide-line-subtle">
              {items.map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <KindIcon kind={activityKind(e)} />
                  <p className="min-w-0 flex-1 pt-1 text-fg-secondary">
                    <span className="font-medium text-fg">{actorLabel(e)}</span>{' '}
                    {describeActivity(e)}
                    {!taskId && e.task ? (
                      <>
                        {' on '}
                        {e.action === 'task.deleted' ? (
                          <span className="font-mono text-xs font-medium">{e.task.key}</span>
                        ) : (
                          <Link
                            href={`/projects/${projectId}/tasks/${e.task.id}`}
                            className="font-mono text-xs font-medium text-primary hover:underline"
                          >
                            {e.task.key}
                          </Link>
                        )}
                      </>
                    ) : null}
                  </p>
                  <time
                    dateTime={e.createdAt}
                    title={new Date(e.createdAt).toLocaleString()}
                    className="shrink-0 pt-1 text-xs whitespace-nowrap text-fg-subtle"
                  >
                    {timeAgo(e.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ))(group.items)}
        </section>
      ))}
      {cursor ? (
        <Button size="sm" onClick={loadMore}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

/** DevTrack user, else the GitHub login for GitHub events, else "System". */
export function actorLabel(e: ActivityEntry): string {
  if (e.actor) return `@${e.actor.username}`;
  const github = (e.metadata as { github?: { login?: string } | null }).github;
  return github?.login ? `${github.login} (GitHub)` : 'System';
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Entries arrive newest first, so consecutive entries on the same day share a group. */
function groupEntries(entries: ActivityEntry[]) {
  const groups: { label: string; items: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(entry);
    else groups.push({ label, items: [entry] });
  }
  return groups;
}

const KIND_STYLE: Record<ActivityKind, { className: string; icon: ReactNode }> = {
  status: {
    className: 'bg-activity-status-bg text-activity-status-fg',
    icon: <StatusChangeIcon size={15} />,
  },
  assign: {
    className: 'bg-activity-assign-bg text-activity-assign-fg',
    icon: <UserIcon size={15} />,
  },
  comment: {
    className: 'bg-activity-comment-bg text-activity-comment-fg',
    icon: <ChatIcon size={15} />,
  },
  repo: { className: 'bg-activity-repo-bg text-activity-repo-fg', icon: <BranchIcon size={15} /> },
  member: {
    className: 'bg-activity-member-bg text-activity-member-fg',
    icon: <UserPlusIcon size={15} />,
  },
  label: { className: 'bg-activity-label-bg text-activity-label-fg', icon: <TagIcon size={15} /> },
  create: {
    className: 'bg-activity-member-bg text-activity-member-fg',
    icon: <PlusIcon size={15} />,
  },
  other: {
    className: 'bg-activity-other-bg text-activity-other-fg',
    icon: <span className="size-1.5 rounded-full bg-current" />,
  },
};

/** 30px tinted circle showing what kind of event this is (decorative; the text says it). */
function KindIcon({ kind }: { kind: ActivityKind }) {
  const { className, icon } = KIND_STYLE[kind];
  return (
    <span
      aria-hidden="true"
      className={`flex size-7.5 shrink-0 items-center justify-center rounded-full ${className}`}
    >
      {icon}
    </span>
  );
}

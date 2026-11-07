'use client';

import type { ActivityEntry } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Avatar, Button } from '@/components/ui';
import { apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { describeActivity, timeAgo } from './describe-activity';

/** Newest-first activity list with "Load more". Pass `taskId` for a single task's history. */
export function ActivityFeed({
  projectId,
  taskId,
  limit = 30,
  refreshKey,
  groupByDay = false,
}: {
  projectId: string;
  taskId?: string;
  limit?: number;
  /** Change to re-fetch (e.g. after the task is edited). */
  refreshKey?: unknown;
  /** Show "Today", "Yesterday" and date headings between entries. */
  groupByDay?: boolean;
}) {
  const base = `/projects/${projectId}/activity?limit=${limit}${taskId ? `&taskId=${taskId}` : ''}`;
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
  if (entries.length === 0) return <p className="text-sm text-fg-subtle">No activity yet.</p>;

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
            <ol className="space-y-3">
              {items.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <Avatar
                    name={e.actor?.username ?? '?'}
                    url={e.actor?.avatarUrl ?? null}
                    seed={e.actor?.id}
                    size="sm"
                  />
                  <p className="min-w-0 flex-1 text-fg-secondary">
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
                    <span
                      className="block text-xs text-fg-subtle"
                      title={new Date(e.createdAt).toLocaleString()}
                    >
                      {timeAgo(e.createdAt)}
                    </span>
                  </p>
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
function actorLabel(e: ActivityEntry): string {
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

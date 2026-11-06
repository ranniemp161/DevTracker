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
}: {
  projectId: string;
  taskId?: string;
  limit?: number;
  /** Change to re-fetch (e.g. after the task is edited). */
  refreshKey?: unknown;
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
  if (!entries) return <p className="text-sm text-neutral-500">Loading activity…</p>;
  if (entries.length === 0) return <p className="text-sm text-neutral-500">No activity yet.</p>;

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <Avatar name={e.actor?.username ?? '?'} url={e.actor?.avatarUrl ?? null} size="sm" />
            <p className="min-w-0 flex-1 text-neutral-700">
              <span className="font-medium text-neutral-900">{actorLabel(e)}</span>{' '}
              {describeActivity(e)}
              {!taskId && e.task ? (
                <>
                  {' on '}
                  {e.action === 'task.deleted' ? (
                    <span className="font-medium">{e.task.key}</span>
                  ) : (
                    <Link
                      href={`/projects/${projectId}/tasks/${e.task.id}`}
                      className="font-medium hover:underline"
                    >
                      {e.task.key}
                    </Link>
                  )}
                </>
              ) : null}
              <span
                className="block text-xs text-neutral-500"
                title={new Date(e.createdAt).toLocaleString()}
              >
                {timeAgo(e.createdAt)}
              </span>
            </p>
          </li>
        ))}
      </ol>
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

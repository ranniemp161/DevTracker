'use client';

import type { Task } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  EmptyState,
  PriorityIcon,
  Skeleton,
  StatusDot,
  UnassignedAvatar,
} from '@/components/ui';
import { apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { LabelChip } from './label-chip';
import { formatDate, TASK_STATUS_LABEL } from './labels';
import { useProject } from './project-context';
import { TaskFilterBar, useTaskFilters } from './task-filters';
import { isListUpdating, resultCountLabel, updatingLabel } from './task-list-status';

/** Fast responses shouldn't flash an "updating" state. */
const UPDATING_DELAY_MS = 150;

/**
 * True once `key` has stayed the same for `delayMs`. Keyed by the pending query, so each
 * new filter change waits again without resetting state synchronously.
 */
function useDelayedKey(key: string | null, delayMs: number): boolean {
  const [shownFor, setShownFor] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = setTimeout(() => setShownFor(key), delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs]);
  return key !== null && shownFor === key;
}

/** List view: newest first, filterable, cursor-paginated (M3 rule 9). */
export function TaskList() {
  const { project, members } = useProject();
  const { filters } = useTaskFilters();
  const [rows, setRows] = useState<Task[] | null>(null);
  /** The query `rows` came from; differs from `base` while a new filter/search loads. */
  const [loadedBase, setLoadedBase] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);
  useRealtimeRefresh(
    (e) => e.projectId === project.id && e.type.startsWith('task.'),
    () => setVersion((v) => v + 1),
  );

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v !== '') as [string, string][],
  );
  query.set('limit', '50');
  const base = `/projects/${project.id}/tasks?${query.toString()}`;
  const latestBase = useRef(base);
  useEffect(() => {
    latestBase.current = base;
  }, [base]);

  const updating = isListUpdating(loadedBase, base);
  const showUpdating = useDelayedKey(updating ? base : null, UPDATING_DELAY_MS);

  useEffect(() => {
    let cancelled = false;
    apiPage<Task>(base).then(
      (page) => {
        if (cancelled) return;
        setRows(page.items);
        setCursor(page.nextCursor);
        setLoadedBase(base);
        setError(null);
      },
      (err: unknown) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load tasks.'),
    );
    return () => {
      cancelled = true;
    };
  }, [base, version]);

  async function loadMore() {
    if (!cursor || updating) return;
    const requestBase = base;
    setLoadingMore(true);
    try {
      const page = await apiPage<Task>(`${requestBase}&cursor=${encodeURIComponent(cursor)}`);
      // The filters changed while this page loaded: it belongs to the old results.
      if (latestBase.current !== requestBase) return;
      setRows((r) => [...(r ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more tasks.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <TaskFilterBar workspaceId={project.workspaceId} projectId={project.id} members={members} />
        {rows ? (
          <p
            role="status"
            aria-live="polite"
            className={showUpdating ? 'text-label text-fg-muted' : 'sr-only'}
          >
            {showUpdating
              ? updatingLabel(Boolean(filters.q))
              : updating
                ? ''
                : resultCountLabel(rows.length, cursor !== null)}
          </p>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table
          aria-busy={updating || undefined}
          className={`w-full min-w-176 text-left text-sm transition-opacity ${
            showUpdating ? 'opacity-60' : ''
          }`}
        >
          <thead className="border-b border-line bg-surface-sunken text-xs text-fg-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Key</th>
              <th className="px-4 py-2.5 font-medium">Title</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Priority</th>
              <th className="px-4 py-2.5 font-medium">Assignees</th>
              <th className="px-4 py-2.5 font-medium">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows?.map((t) => (
              <tr key={t.id} className="transition-colors hover:bg-surface-sunken">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-fg-muted">
                  {t.key}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/projects/${project.id}/tasks/${t.id}`}
                    className="font-medium text-fg hover:underline"
                  >
                    {t.title}
                  </Link>
                  {t.labels.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.labels.map((l) => (
                        <LabelChip key={l.id} label={l} />
                      ))}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <StatusDot status={t.status} />
                    {TASK_STATUS_LABEL[t.status]}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <PriorityIcon priority={t.priority} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex -space-x-1.5">
                    {t.assignees.length === 0 ? <UnassignedAvatar /> : null}
                    {t.assignees.map((a) => (
                      <span
                        key={a.id}
                        title={`@${a.username}`}
                        className="rounded-full ring-2 ring-surface"
                      >
                        <Avatar name={a.username} url={a.avatarUrl} seed={a.id} size="xs" />
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-fg-muted">
                  {formatDate(t.dueDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 ? (
          <div className="p-4">
            <EmptyState>No tasks match these filters.</EmptyState>
          </div>
        ) : null}
        {!rows && !error ? (
          <div role="status" aria-label="Loading tasks" className="space-y-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : null}
      </div>
      {cursor && !updating ? (
        <Button onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}

'use client';

import type { Task } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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

/** List view: newest first, filterable, cursor-paginated (M3 rule 9). */
export function TaskList() {
  const { project, members } = useProject();
  const { filters } = useTaskFilters();
  const [rows, setRows] = useState<Task[] | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    apiPage<Task>(base).then(
      (page) => {
        if (cancelled) return;
        setRows(page.items);
        setCursor(page.nextCursor);
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
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiPage<Task>(`${base}&cursor=${encodeURIComponent(cursor)}`);
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
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-176 text-left text-sm">
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
      {cursor ? (
        <Button onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}

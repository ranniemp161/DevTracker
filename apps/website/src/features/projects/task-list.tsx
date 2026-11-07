'use client';

import type { Task } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { LabelChip } from './label-chip';
import { formatDate, PRIORITY_LABEL, PRIORITY_TONE, TASK_STATUS_LABEL } from './labels';
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
      {/* Filters toolbar */}
      <div className="rounded-xl border border-border bg-surface p-3.5 shadow-xs">
        <TaskFilterBar workspaceId={project.workspaceId} members={members} />
      </div>

      {error ? <ErrorState message={error} onRetry={() => setVersion((v) => v + 1)} /> : null}

      {/* Loading state skeleton */}
      {!rows && !error ? (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <Skeleton className="h-8 w-full rounded" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-12 w-full rounded" />
          <Skeleton className="h-12 w-full rounded" />
        </div>
      ) : null}

      {/* Empty State */}
      {rows && rows.length === 0 ? (
        <EmptyState
          title="No tasks match these filters"
          description="Try selecting different filter options or create a new task."
        />
      ) : null}

      {/* Task table / cards */}
      {rows && rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
          {/* Desktop view: Table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-subtle/50 font-semibold text-mineral uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Assignees</th>
                  <th className="px-4 py-3">Due date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="group hover:bg-subtle/40 transition-colors duration-100"
                  >
                    <td className="px-4 py-3 whitespace-nowrap font-mono font-medium text-mineral group-hover:text-accent">
                      <Link href={`/projects/${project.id}/tasks/${t.id}`}>{t.key}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/projects/${project.id}/tasks/${t.id}`}
                        className="font-medium text-graphite group-hover:text-accent-text transition-colors"
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
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-graphite">
                      {TASK_STATUS_LABEL[t.status]}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex -space-x-1">
                        {t.assignees.map((a) => (
                          <span
                            key={a.id}
                            title={`@${a.username}`}
                            className="rounded-full ring-1 ring-surface"
                          >
                            <Avatar name={a.username} url={a.avatarUrl} size="xs" />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-mineral">
                      {formatDate(t.dueDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile view: Stacked card items */}
          <ul className="divide-y divide-border/60 sm:hidden">
            {rows.map((t) => (
              <li key={t.id} className="p-3.5 hover:bg-subtle/40 transition-colors">
                <Link href={`/projects/${project.id}/tasks/${t.id}`} className="block space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-accent">{t.key}</span>
                    <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                  </div>
                  <p className="text-sm font-medium text-graphite leading-snug">{t.title}</p>
                  {t.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {t.labels.map((l) => (
                        <LabelChip key={l.id} label={l} />
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 pt-1 text-xs text-mineral">
                    <span>{TASK_STATUS_LABEL[t.status]}</span>
                    <div className="flex items-center gap-2">
                      {t.dueDate ? <span>Due {formatDate(t.dueDate)}</span> : null}
                      <div className="flex -space-x-1">
                        {t.assignees.map((a) => (
                          <span key={a.id} className="rounded-full ring-1 ring-surface">
                            <Avatar name={a.username} url={a.avatarUrl} size="xs" />
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cursor ? (
        <div className="pt-2 text-center">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading more…' : 'Load more tasks'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

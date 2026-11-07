'use client';

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Label,
  type ProjectMember,
  type Task,
} from '@devtrack/types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useApiQuery } from '@/lib/use-api-query';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from './labels';

export interface TaskFilters {
  status: string;
  priority: string;
  assigneeId: string;
  labelId: string;
}

export function useTaskFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: TaskFilters = useMemo(
    () => ({
      status: searchParams.get('status') ?? '',
      priority: searchParams.get('priority') ?? '',
      assigneeId: searchParams.get('assigneeId') ?? '',
      labelId: searchParams.get('labelId') ?? '',
    }),
    [searchParams],
  );

  const setFilter = useCallback(
    (name: keyof TaskFilters, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) {
        next.set(name, value);
      } else {
        next.delete(name);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, router, pathname],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname);
  }, [router, pathname]);

  const hasActiveFilters = Boolean(
    filters.status || filters.priority || filters.assigneeId || filters.labelId,
  );

  return { filters, setFilter, clearFilters, hasActiveFilters };
}

export function filterTask(task: Task, filters: TaskFilters): boolean {
  if (filters.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (filters.assigneeId) {
    if (filters.assigneeId === 'unassigned') {
      if (task.assignees.length > 0) return false;
    } else if (!task.assignees.some((a) => a.id === filters.assigneeId)) {
      return false;
    }
  }
  if (filters.labelId && !task.labels.some((l) => l.id === filters.labelId)) return false;
  return true;
}

export function TaskFilterBar({
  workspaceId,
  members,
}: {
  workspaceId: string;
  members: ProjectMember[];
}) {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useTaskFilters();
  const labelsQuery = useApiQuery<Label[]>(`/workspaces/${workspaceId}/labels`);
  const labels = labelsQuery.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">
        <span className="sr-only">Status</span>
        <select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium text-neutral-800"
        >
          <option value="">Status: all</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="sr-only">Priority</span>
        <select
          value={filters.priority}
          onChange={(e) => setFilter('priority', e.target.value)}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium text-neutral-800"
        >
          <option value="">Priority: all</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <span className="sr-only">Assignee</span>
        <select
          value={filters.assigneeId}
          onChange={(e) => setFilter('assigneeId', e.target.value)}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium text-neutral-800"
        >
          <option value="">Assignee: all</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              @{m.user.username}
            </option>
          ))}
        </select>
      </label>

      {labels.length > 0 ? (
        <label className="text-sm">
          <span className="sr-only">Label</span>
          <select
            value={filters.labelId}
            onChange={(e) => setFilter('labelId', e.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium text-neutral-800"
          >
            <option value="">Label: all</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:text-neutral-900"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

'use client';

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Label,
  type ProjectMember,
  type Task,
} from '@devtrack/types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, type ReactNode } from 'react';
import { ChevronDownIcon } from '@/components/icons';
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

/** A native select styled as a toolbar filter. Active filters get a darker border. */
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-7.5 cursor-pointer appearance-none rounded-control border bg-surface pr-7 pl-2.5 text-label font-medium transition-colors hover:bg-surface-sunken ${
          value ? 'border-fg text-fg' : 'border-line-control text-fg-secondary'
        }`}
      >
        {children}
      </select>
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-subtle"
      />
    </label>
  );
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
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)}>
        <option value="">Status: all</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Priority"
        value={filters.priority}
        onChange={(v) => setFilter('priority', v)}
      >
        <option value="">Priority: all</option>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Assignee"
        value={filters.assigneeId}
        onChange={(v) => setFilter('assigneeId', v)}
      >
        <option value="">Assignee: all</option>
        <option value="unassigned">Unassigned</option>
        {members.map((m) => (
          <option key={m.user.id} value={m.user.id}>
            @{m.user.username}
          </option>
        ))}
      </FilterSelect>

      {labels.length > 0 ? (
        <FilterSelect
          label="Label"
          value={filters.labelId}
          onChange={(v) => setFilter('labelId', v)}
        >
          <option value="">Label: all</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </FilterSelect>
      ) : null}

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={clearFilters}
          className="h-7.5 rounded-control px-2.5 text-label font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

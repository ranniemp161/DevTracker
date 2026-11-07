'use client';

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Label,
  type ProjectMember,
  type Task,
} from '@devtrack/types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
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

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.status) count++;
    if (filters.priority) count++;
    if (filters.assigneeId) count++;
    if (filters.labelId) count++;
    return count;
  }, [filters]);

  const hasActiveFilters = activeFilterCount > 0;

  return { filters, setFilter, clearFilters, hasActiveFilters, activeFilterCount };
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
  const { filters, setFilter, clearFilters, hasActiveFilters, activeFilterCount } =
    useTaskFilters();
  const labelsQuery = useApiQuery<Label[]>(`/workspaces/${workspaceId}/labels`);
  const labels = labelsQuery.data ?? [];
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const selectBaseClass =
    'rounded-lg border bg-surface px-2.5 py-1.5 text-xs font-medium text-graphite transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 cursor-pointer';

  return (
    <div className="w-full">
      {/* Mobile filter disclosure toggle */}
      <div className="flex items-center justify-between sm:hidden">
        <button
          type="button"
          onClick={() => setMobileExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-graphite shadow-xs hover:bg-subtle"
          aria-expanded={mobileExpanded}
        >
          <svg
            aria-hidden="true"
            className="size-3.5 text-mineral"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.972.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 018 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.659 6.22A2.25 2.25 0 012 4.629V2.34a.75.75 0 01.628-.74z"
              clipRule="evenodd"
            />
          </svg>
          <span>Filters</span>
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-accent px-1.5 py-0.2 text-[10px] font-semibold text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </button>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-mineral hover:text-graphite underline underline-offset-2"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {/* Filter items: collapsible on mobile, always visible inline on desktop */}
      <div
        className={`${
          mobileExpanded ? 'mt-3 flex' : 'hidden'
        } sm:flex flex-wrap items-center gap-2`}
      >
        <label className="text-xs">
          <span className="sr-only">Status filter</span>
          <select
            value={filters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className={`${selectBaseClass} ${
              filters.status
                ? 'border-accent bg-accent-tint/30 text-accent-text font-semibold'
                : 'border-border'
            }`}
          >
            <option value="">Status: All</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="sr-only">Priority filter</span>
          <select
            value={filters.priority}
            onChange={(e) => setFilter('priority', e.target.value)}
            className={`${selectBaseClass} ${
              filters.priority
                ? 'border-accent bg-accent-tint/30 text-accent-text font-semibold'
                : 'border-border'
            }`}
          >
            <option value="">Priority: All</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs">
          <span className="sr-only">Assignee filter</span>
          <select
            value={filters.assigneeId}
            onChange={(e) => setFilter('assigneeId', e.target.value)}
            className={`${selectBaseClass} ${
              filters.assigneeId
                ? 'border-accent bg-accent-tint/30 text-accent-text font-semibold'
                : 'border-border'
            }`}
          >
            <option value="">Assignee: All</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                @{m.user.username}
              </option>
            ))}
          </select>
        </label>

        {labels.length > 0 ? (
          <label className="text-xs">
            <span className="sr-only">Label filter</span>
            <select
              value={filters.labelId}
              onChange={(e) => setFilter('labelId', e.target.value)}
              className={`${selectBaseClass} ${
                filters.labelId
                  ? 'border-accent bg-accent-tint/30 text-accent-text font-semibold'
                  : 'border-border'
              }`}
            >
              <option value="">Label: All</option>
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
            className="hidden sm:inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-mineral hover:bg-subtle hover:text-graphite transition-colors"
          >
            <svg aria-hidden="true" className="size-3" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

'use client';

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Label,
  type Milestone,
  type ProjectMember,
} from '@devtrack/types';
import { TASK_SEARCH_MAX_LENGTH } from '@devtrack/validators';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SearchIcon } from '@/components/icons';
import { useApiQuery } from '@/lib/use-api-query';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from './labels';
import type { TaskFilters } from './task-filter-match';

export { filterTask, type TaskFilters } from './task-filter-match';

/** How long typing pauses before the search updates the URL. */
const SEARCH_DEBOUNCE_MS = 250;

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
      milestoneId: searchParams.get('milestoneId') ?? '',
      q: searchParams.get('q') ?? '',
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
    filters.status ||
    filters.priority ||
    filters.assigneeId ||
    filters.labelId ||
    filters.milestoneId ||
    filters.q,
  );

  return { filters, setFilter, clearFilters, hasActiveFilters };
}

/**
 * Search box. Keeps its own draft so typing stays responsive, and writes to the URL after a
 * short pause. When the URL changes from elsewhere (Clear filters, back button), the draft follows.
 */
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    // Keep a trailing space the user is still typing; only adopt real outside changes.
    if (value !== draft.trim()) setDraft(value);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const timer = setTimeout(() => onChange(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <label className="relative inline-flex">
      <span className="sr-only">Search tasks</span>
      <SearchIcon
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle"
      />
      <input
        type="search"
        value={draft}
        maxLength={TASK_SEARCH_MAX_LENGTH}
        placeholder="Search tasks"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && draft !== '') {
            e.preventDefault();
            setDraft('');
            onChange('');
          }
        }}
        className={`h-7.5 w-56 rounded-control border bg-surface pr-2.5 pl-8 text-label text-fg transition-colors placeholder:text-fg-subtle ${
          value ? 'border-fg' : 'border-line-control'
        }`}
      />
    </label>
  );
}

/** A native select styled as a toolbar filter. Active filters get a darker border. */
export function FilterSelect({
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
  projectId,
  members,
}: {
  workspaceId: string;
  projectId: string;
  members: ProjectMember[];
}) {
  const { filters, setFilter, clearFilters, hasActiveFilters } = useTaskFilters();
  const labelsQuery = useApiQuery<Label[]>(`/workspaces/${workspaceId}/labels`);
  const labels = labelsQuery.data ?? [];
  const milestonesQuery = useApiQuery<Milestone[]>(`/projects/${projectId}/milestones`);
  const milestones = milestonesQuery.data ?? [];

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <SearchField value={filters.q} onChange={(v) => setFilter('q', v)} />

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

      {milestones.length > 0 || filters.milestoneId ? (
        <FilterSelect
          label="Milestone"
          value={filters.milestoneId}
          onChange={(v) => setFilter('milestoneId', v)}
        >
          <option value="">Milestone: all</option>
          <option value="none">No milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
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

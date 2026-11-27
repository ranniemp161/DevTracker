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
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDownIcon, SearchIcon, XIcon } from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';
import { Avatar, PriorityIcon, StatusDot } from '@/components/ui';
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
    <label className="relative inline-flex min-w-0 max-lg:flex-1">
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
        className={`h-7.5 w-full rounded-control border bg-surface pr-2.5 pl-8 text-label pointer-coarse:h-11 lg:w-56 text-fg transition-colors placeholder:text-fg-subtle ${
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
        className={`h-7.5 cursor-pointer appearance-none rounded-control border bg-surface pr-7 pl-2.5 pointer-coarse:h-11 text-label font-medium transition-colors hover:bg-surface-sunken ${
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

export interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/**
 * Toolbar filter (SPEC §4 FilterChip): shows the field name when off, and "Field: value"
 * with a clear (×) button when on. Opens the shared Menu to pick a value.
 */
export function FilterMenu({
  label,
  value,
  options,
  onChange,
  emptyLabel = 'Any',
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Name of the "no filter" choice. */
  emptyLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  const active = Boolean(value);
  return (
    <div
      className={`inline-flex items-center rounded-control border transition-colors ${
        active
          ? 'border-fg bg-fg text-fg-on-inverse'
          : 'border-line-control bg-surface text-fg-secondary hover:bg-surface-sunken'
      }`}
    >
      <Menu
        label={label}
        triggerProps={{
          'aria-label': active
            ? `${label}: ${current?.label ?? value}. Change`
            : `Filter by ${label.toLowerCase()}`,
        }}
        triggerClassName="inline-flex h-7.5 items-center gap-1.5 rounded-control px-2.5 text-label font-medium pointer-coarse:h-11"
        menuClassName="w-56"
        trigger={
          active ? (
            <>
              {label}: {current?.label ?? '…'}
            </>
          ) : (
            <>
              {label}
              <ChevronDownIcon size={14} className="text-fg-subtle" />
            </>
          )
        }
      >
        <MenuItem checked={!active} onSelect={() => onChange('')}>
          {emptyLabel}
        </MenuItem>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            checked={o.value === value}
            icon={o.icon}
            onSelect={() => onChange(o.value)}
          >
            {o.label}
          </MenuItem>
        ))}
      </Menu>
      {active ? (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()} filter`}
          onClick={() => onChange('')}
          className="touch-target -ml-1 inline-flex h-7.5 items-center rounded-control pr-2 pl-1 opacity-80 hover:opacity-100 pointer-coarse:h-11"
        >
          <XIcon size={12} />
        </button>
      ) : null}
    </div>
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
  // Phones show search plus a Filters toggle; the selects take four rows otherwise.
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const activeCount = [
    filters.status,
    filters.priority,
    filters.assigneeId,
    filters.labelId,
    filters.milestoneId,
  ].filter(Boolean).length;

  return (
    <div
      role="group"
      aria-label="Filters"
      className="flex flex-wrap items-center gap-2 max-lg:min-w-0 max-lg:flex-1"
    >
      <SearchField value={filters.q} onChange={(v) => setFilter('q', v)} />
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((open) => !open)}
        className={`inline-flex h-7.5 items-center gap-1.5 rounded-control border border-dashed px-2.5 text-label font-medium transition-colors hover:bg-surface-sunken pointer-coarse:h-11 lg:hidden ${
          activeCount ? 'border-fg text-fg' : 'border-line-control text-fg-secondary'
        }`}
      >
        Filters{activeCount ? ` · ${activeCount}` : ''}
        <ChevronDownIcon size={14} className={expanded ? 'rotate-180' : ''} />
      </button>
      <div
        id={panelId}
        className={`contents ${expanded ? 'max-lg:flex max-lg:w-full max-lg:flex-wrap max-lg:gap-2' : 'max-lg:hidden'}`}
      >
        <FilterMenu
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter('status', v)}
          options={TASK_STATUSES.map((st) => ({
            value: st,
            label: TASK_STATUS_LABEL[st],
            icon: <StatusDot status={st} />,
          }))}
        />
        <FilterMenu
          label="Priority"
          value={filters.priority}
          onChange={(v) => setFilter('priority', v)}
          options={TASK_PRIORITIES.map((pr) => ({
            value: pr,
            label: PRIORITY_LABEL[pr],
            icon: <PriorityIcon priority={pr} showLabel={false} />,
          }))}
        />
        <FilterMenu
          label="Assignee"
          value={filters.assigneeId}
          onChange={(v) => setFilter('assigneeId', v)}
          options={[
            {
              value: 'unassigned',
              label: 'Unassigned',
              icon: (
                <span
                  aria-hidden="true"
                  className="size-5 shrink-0 rounded-full border border-dashed border-line-control"
                />
              ),
            },
            ...members.map((m) => ({
              value: m.user.id,
              label: `@${m.user.username}`,
              icon: (
                <Avatar name={m.user.username} url={m.user.avatarUrl} seed={m.user.id} size="xs" />
              ),
            })),
          ]}
        />
        {labels.length > 0 ? (
          <FilterMenu
            label="Label"
            value={filters.labelId}
            onChange={(v) => setFilter('labelId', v)}
            options={labels.map((l) => ({
              value: l.id,
              label: l.name,
              icon: (
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-xs"
                  style={{ backgroundColor: l.color }}
                />
              ),
            }))}
          />
        ) : null}
        {milestones.length > 0 || filters.milestoneId ? (
          <FilterMenu
            label="Milestone"
            value={filters.milestoneId}
            onChange={(v) => setFilter('milestoneId', v)}
            options={[
              { value: 'none', label: 'No milestone' },
              { value: 'added', label: 'Added after start' },
              ...milestones.map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        ) : null}

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="h-7.5 rounded-control px-2.5 text-label font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg pointer-coarse:h-11"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

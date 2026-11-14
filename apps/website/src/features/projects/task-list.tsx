'use client';

import type { Task } from '@devtrack/types';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { BulkActionBar } from './bulk-action-bar';
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
import { FilterSelect, TaskFilterBar, useTaskFilters } from './task-filters';
import {
  groupByStatus,
  isListUpdating,
  parseListGrouping,
  resultCountLabel,
  updatingLabel,
} from './task-list-status';
import { selectionState, toggleAll, toggleOne } from './task-selection';

/** Row checkbox props; omitted when the viewer can't edit (read-only project). */
interface RowSelect {
  checked: boolean;
  onToggle: () => void;
}

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
  const { project, members, readOnly } = useProject();
  const { filters } = useTaskFilters();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const grouping = parseListGrouping(searchParams.get('group'));
  function setGrouping(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'status') params.set('group', 'status');
    else params.delete('group');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }
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
  if (grouping === 'status') query.set('sort', 'status');
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

  const groups = rows && grouping === 'status' ? groupByStatus(rows, cursor !== null) : null;

  // Selection belongs to one query: changing filters, search or grouping starts fresh.
  const [selection, setSelection] = useState<{ base: string; ids: Set<string> }>({
    base: '',
    ids: new Set(),
  });
  const selected = selection.base === base && !updating ? selection.ids : new Set<string>();
  const loadedIds = rows?.map((t) => t.id) ?? [];
  const setSelected = (ids: Set<string>) => setSelection({ base, ids });
  const canSelect = !readOnly && rows !== null && rows.length > 0;
  const rowSelect = (id: string): RowSelect | undefined =>
    canSelect
      ? { checked: selected.has(id), onToggle: () => setSelected(toggleOne(selected, id)) }
      : undefined;
  const allState = selectionState(selected, loadedIds);
  const columns = canSelect ? 7 : 6;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <TaskFilterBar workspaceId={project.workspaceId} projectId={project.id} members={members} />
        <FilterSelect
          label="Group by"
          value={grouping === 'status' ? 'status' : ''}
          onChange={setGrouping}
        >
          <option value="">Group by: none</option>
          <option value="status">Group by: status</option>
        </FilterSelect>
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
          className={`hidden w-full min-w-176 text-left text-sm transition-opacity md:table ${
            showUpdating ? 'opacity-60' : ''
          }`}
        >
          <thead className="border-b border-line bg-surface-sunken text-xs text-fg-muted">
            <tr>
              {canSelect ? (
                <th className="w-10 py-2.5 pl-4">
                  <SelectBox
                    label="Select all loaded tasks"
                    state={allState}
                    onToggle={() => setSelected(toggleAll(selected, loadedIds))}
                  />
                </th>
              ) : null}
              <th className="px-4 py-2.5 font-medium">Key</th>
              <th className="px-4 py-2.5 font-medium">Title</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Priority</th>
              <th className="px-4 py-2.5 font-medium">Assignees</th>
              <th className="px-4 py-2.5 font-medium">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {groups
              ? groups.map((g) => (
                  <Fragment key={g.status}>
                    <tr className="bg-surface-sunken">
                      <th
                        colSpan={columns}
                        scope="colgroup"
                        className="px-4 py-2 text-left text-label font-medium text-fg-secondary"
                      >
                        <span className="inline-flex items-center gap-2">
                          <StatusDot status={g.status} />
                          {TASK_STATUS_LABEL[g.status]}
                          <span className="font-normal text-fg-muted">{g.countLabel}</span>
                        </span>
                      </th>
                    </tr>
                    {g.tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        projectId={project.id}
                        select={rowSelect(t.id)}
                      />
                    ))}
                  </Fragment>
                ))
              : rows?.map((t) => (
                  <TaskRow key={t.id} task={t} projectId={project.id} select={rowSelect(t.id)} />
                ))}
          </tbody>
        </table>
        {/* Under 768px the table becomes stacked rows (SPEC §6): title, then a meta line. */}
        <ul
          aria-label="Tasks"
          aria-busy={updating || undefined}
          className={`divide-y divide-line-subtle transition-opacity md:hidden ${
            showUpdating ? 'opacity-60' : ''
          }`}
        >
          {groups
            ? groups.map((g) => (
                <Fragment key={g.status}>
                  <li className="flex items-center gap-2 bg-surface-sunken px-4 py-2 text-label font-medium text-fg-secondary">
                    <StatusDot status={g.status} />
                    {TASK_STATUS_LABEL[g.status]}
                    <span className="font-normal text-fg-muted">{g.countLabel}</span>
                  </li>
                  {g.tasks.map((t) => (
                    <StackedRow
                      key={t.id}
                      task={t}
                      projectId={project.id}
                      select={rowSelect(t.id)}
                    />
                  ))}
                </Fragment>
              ))
            : rows?.map((t) => (
                <StackedRow key={t.id} task={t} projectId={project.id} select={rowSelect(t.id)} />
              ))}
        </ul>
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
      {canSelect && selected.size > 0 ? (
        <BulkActionBar
          projectId={project.id}
          workspaceId={project.workspaceId}
          members={members}
          selectedIds={[...selected]}
          onApplied={() => {
            setSelected(new Set());
            setVersion((v) => v + 1);
          }}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </div>
  );
}

/** Native checkbox; `some` shows the indeterminate dash (the header box). */
function SelectBox({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: 'none' | 'some' | 'all';
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      onChange={onToggle}
      className="size-4 cursor-pointer accent-primary"
    />
  );
}

function TaskRow({
  task: t,
  projectId,
  select,
}: {
  task: Task;
  projectId: string;
  select?: RowSelect;
}) {
  return (
    <tr
      className={`transition-colors hover:bg-surface-sunken ${select?.checked ? 'bg-primary-soft' : ''}`}
    >
      {select ? (
        <td className="w-10 py-2.5 pl-4">
          <SelectBox
            label={`Select ${t.key}`}
            state={select.checked ? 'all' : 'none'}
            onToggle={select.onToggle}
          />
        </td>
      ) : null}
      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-fg-muted">{t.key}</td>
      <td className="px-4 py-2.5">
        <Link
          href={`/projects/${projectId}/tasks/${t.id}`}
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
            <span key={a.id} title={`@${a.username}`} className="rounded-full ring-2 ring-surface">
              <Avatar name={a.username} url={a.avatarUrl} seed={a.id} size="xs" />
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap text-fg-muted">{formatDate(t.dueDate)}</td>
    </tr>
  );
}

/** Phone layout of one task: the title on top, then key · status · priority · due · people. */
function StackedRow({
  task: t,
  projectId,
  select,
}: {
  task: Task;
  projectId: string;
  select?: RowSelect;
}) {
  return (
    <li className={`flex gap-3 px-4 py-3 ${select?.checked ? 'bg-primary-soft' : ''}`}>
      {select ? (
        <span className="pt-0.5">
          <SelectBox
            label={`Select ${t.key}`}
            state={select.checked ? 'all' : 'none'}
            onToggle={select.onToggle}
          />
        </span>
      ) : null}
      <div className="min-w-0 flex-1 space-y-1.5">
        <Link
          href={`/projects/${projectId}/tasks/${t.id}`}
          className="block font-medium break-words text-fg hover:underline"
        >
          {t.title}
        </Link>
        {t.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {t.labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span className="font-mono">{t.key}</span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status={t.status} />
            {TASK_STATUS_LABEL[t.status]}
          </span>
          <PriorityIcon priority={t.priority} />
          {t.dueDate ? <span>Due {formatDate(t.dueDate)}</span> : null}
          <span className="flex -space-x-1.5">
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
          </span>
        </div>
      </div>
    </li>
  );
}

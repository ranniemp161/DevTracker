'use client';

import type { WorkspaceSearchResponse } from '@devtrack/types';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { SearchIcon, SpinnerIcon } from '@/components/icons';
import { avatarTone, Badge, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import { moveActive, searchItems, searchPath, type SearchItem } from './search-results';

const DEBOUNCE_MS = 200;

interface Result {
  path: string;
  data?: WorkspaceSearchResponse;
  failed?: boolean;
}

/**
 * Workspace search (decision record 0017). A native modal <dialog>: the browser makes the page
 * inert, closes on Escape and returns focus to the opener. The input is a combobox over one
 * listbox, so ↑/↓ move through tasks then projects and Enter opens the active row.
 */
export function SearchDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [result, setResult] = useState<Result>();
  const [active, setActive] = useState<{ path: string | null; index: number }>({
    path: null,
    index: -1,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Search once typing pauses; the previous results stay until the new ones arrive.
  useEffect(() => {
    const next = searchPath(workspaceId, query);
    const timer = setTimeout(() => setPath(next), next ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [workspaceId, query]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<WorkspaceSearchResponse>(path).then(
      (data) => !cancelled && setResult({ path, data }),
      () => !cancelled && setResult({ path, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);

  const typed = query.trim() !== '';
  const shown = typed && path ? result : undefined;
  const loading = typed && (path === null || result?.path !== path);
  const items = searchItems(shown?.data);
  const activeIndex =
    active.path === (shown?.path ?? null) && active.index < items.length
      ? active.index
      : items.length > 0
        ? 0
        : -1;
  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;

  const close = () => dialogRef.current?.close();
  const open = (item: SearchItem) => {
    // Tell the shell directly: navigating can unmount the dialog before its `close` event
    // reaches React, and the search would then reopen on the next page.
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const index = moveActive(activeIndex, e.key === 'ArrowDown' ? 1 : -1, items.length);
      setActive({ path: shown?.path ?? null, index });
      document.getElementById(optionId(listId, items[index]))?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeItem) {
      e.preventDefault();
      open(activeItem);
    }
  };

  const tasks = items.filter((i) => i.kind === 'task');
  const projects = items.filter((i) => i.kind === 'project');
  const row = (item: SearchItem) => (
    <li
      key={item.id}
      id={optionId(listId, item)}
      role="option"
      aria-selected={item === activeItem}
      onClick={() => open(item)}
      onMouseMove={() =>
        item !== activeItem && setActive({ path: shown?.path ?? null, index: items.indexOf(item) })
      }
      className={`flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 pointer-coarse:py-3 ${
        item === activeItem ? 'bg-surface-muted' : ''
      }`}
    >
      {item.kind === 'task' ? <TaskRow item={item} /> : <ProjectRow item={item} />}
    </li>
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-0 h-dvh max-h-none w-full max-w-none flex-col border-0 bg-surface p-0 text-fg open:flex backdrop:bg-fg/40 sm:mx-auto sm:mt-24 sm:mb-auto sm:h-auto sm:max-w-xl sm:rounded-panel sm:border sm:border-line sm:shadow-overlay"
    >
      <h2 id={titleId} className="sr-only">
        Search this workspace
      </h2>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 pt-[env(safe-area-inset-top)]">
        <SearchIcon size={16} className="shrink-0 text-fg-muted" />
        <input
          type="search"
          role="combobox"
          aria-label="Search tasks and projects"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? optionId(listId, activeItem) : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search tasks and projects"
          className="h-13 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-subtle sm:text-sm"
        />
        {loading ? <SpinnerIcon size={14} className="shrink-0 text-fg-muted" /> : null}
        <button
          type="button"
          onClick={close}
          className="touch-target shrink-0 rounded-control px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
        >
          <span className="hidden sm:inline">Esc</span>
          <span className="sm:hidden">Cancel</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:max-h-96">
        <ul id={listId} role="listbox" aria-label="Search results">
          {tasks.length > 0 ? (
            <Group label="Tasks" listId={listId}>
              {tasks.map(row)}
            </Group>
          ) : null}
          {projects.length > 0 ? (
            <Group label="Projects" listId={listId}>
              {projects.map(row)}
            </Group>
          ) : null}
        </ul>
        <p role="status" className="px-3 py-6 text-center text-sm text-fg-muted empty:hidden">
          {!typed
            ? 'Type to search tasks by key, title or description, and projects by name.'
            : shown?.failed
              ? 'Search failed. Check your connection and try again.'
              : shown?.data && items.length === 0
                ? `No results for “${query.trim()}”.`
                : shown?.data?.hasMoreTasks
                  ? 'Showing the first 20 tasks. Type more to narrow it down.'
                  : ''}
        </p>
      </div>
    </dialog>
  );
}

const optionId = (listId: string, item: SearchItem | undefined) =>
  item ? `${listId}-${item.id}` : '';

function Group({
  label,
  listId,
  children,
}: {
  label: string;
  listId: string;
  children: React.ReactNode;
}) {
  const id = `${listId}-${label}`;
  return (
    <li role="presentation" className="mb-1">
      <div id={id} className="px-3 pt-2 pb-1 text-xs font-medium text-fg-muted">
        {label}
      </div>
      <ul role="group" aria-labelledby={id}>
        {children}
      </ul>
    </li>
  );
}

function TaskRow({ item }: { item: Extract<SearchItem, { kind: 'task' }> }) {
  const { task } = item;
  return (
    <>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="shrink-0 font-mono text-xs text-fg-muted">{task.key}</span>
          <span className="truncate font-medium text-fg">{task.title}</span>
        </p>
        <p className="truncate text-xs text-fg-muted">
          {task.project.name}
          {task.project.status === 'ARCHIVED' ? ' · Archived' : ''}
        </p>
      </div>
      <span className="shrink-0">
        <StatusPill status={task.status} />
      </span>
    </>
  );
}

function ProjectRow({ item }: { item: Extract<SearchItem, { kind: 'project' }> }) {
  const { project } = item;
  return (
    <>
      <span
        aria-hidden="true"
        className={`flex size-6 shrink-0 items-center justify-center rounded-chip text-xs font-semibold uppercase ${avatarTone(project.id)}`}
      >
        {project.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{project.name}</span>
      {project.status === 'ARCHIVED' ? <Badge>Archived</Badge> : null}
      <span className="shrink-0 font-mono text-xs text-fg-subtle">{project.key}</span>
    </>
  );
}

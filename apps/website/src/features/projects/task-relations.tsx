'use client';

import type { RelatedTask, TaskRelationKind, WorkspaceSearchResponse } from '@devtrack/types';
import { useEffect, useId, useRef, useState } from 'react';
import { SearchIcon, XIcon } from '@/components/icons';
import { Button, IconButton, SegmentedControl, Skeleton, StatusDot } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from './project-context';
import { TASK_STATUS_LABEL } from './labels';
import { TaskLink } from '@/components/task-link';

const GROUPS: { kind: TaskRelationKind; title: string }[] = [
  { kind: 'BLOCKED_BY', title: 'Blocked by' },
  { kind: 'BLOCKS', title: 'Blocks' },
  { kind: 'RELATES', title: 'Related to' },
];

/**
 * Relations on the task page (decision record 0020): blocked by, blocks and related tasks,
 * with a picker that searches the workspace. Changes save straight away.
 */
export function TaskRelations({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const { project, readOnly } = useProject();
  const headingId = useId();
  const path = `/tasks/${taskId}/relations`;
  const query = useApiQuery<{ relations: RelatedTask[] }>(path);
  useRealtimeRefresh(
    (e) => e.type === 'task.updated' && e.payload.taskId === taskId && 'relation' in e.payload,
    query.reload,
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const relations = query.data?.relations;

  async function remove(relation: RelatedTask) {
    setError(null);
    try {
      await api(`${path}/${relation.relationId}`, { method: 'DELETE' });
      query.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the link.');
    }
  }

  if (readOnly && relations?.length === 0) return null;

  // 0031 #6: when empty, collapse to just the button — no heading or explanatory text.
  const empty = relations !== undefined && relations.length === 0;
  if (empty && !readOnly) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
          Link task
        </Button>
        {picking ? (
          <LinkTaskDialog
            taskId={taskId}
            workspaceId={project.workspaceId}
            linked={new Set()}
            onClose={() => setPicking(false)}
            onLinked={() => {
              query.reload();
              onChanged();
            }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-md font-semibold">
          Relations
        </h2>
        {readOnly ? null : (
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            Link task
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {query.error ? (
        <p className="text-sm text-fg-muted">Could not load relations.</p>
      ) : !relations ? (
        <Skeleton className="h-10" />
      ) : (
        <div className="space-y-3">
          {GROUPS.map(({ kind, title }) => {
            const group = relations.filter((r) => r.kind === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind}>
                <h3 className="mb-1 text-xs font-medium text-fg-muted">{title}</h3>
                <ul className="-mx-2">
                  {group.map((r) => (
                    <li
                      key={r.relationId}
                      className="group/row flex min-h-9 items-center gap-2.5 rounded-control px-2 hover:bg-surface-muted pointer-coarse:min-h-11"
                    >
                      <StatusDot status={r.task.status} />
                      <span className="sr-only">{TASK_STATUS_LABEL[r.task.status]}</span>
                      <span className="shrink-0 font-mono text-xs text-fg-muted">{r.task.key}</span>
                      <TaskLink
                        href={`/projects/${r.task.projectId}/tasks/${r.task.id}`}
                        className={`min-w-0 flex-1 truncate text-sm hover:underline ${
                          r.task.status === 'DONE' ? 'text-fg-subtle line-through' : 'text-fg'
                        }`}
                      >
                        {r.task.title}
                      </TaskLink>
                      {r.task.projectId !== project.id ? (
                        <span className="hidden shrink-0 text-xs text-fg-subtle sm:inline">
                          {r.task.projectName}
                        </span>
                      ) : null}
                      {readOnly ? null : (
                        <IconButton
                          size="sm"
                          aria-label={`Remove the link to ${r.task.key}`}
                          onClick={() => remove(r)}
                          className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        >
                          <XIcon size={12} />
                        </IconButton>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {picking ? (
        <LinkTaskDialog
          taskId={taskId}
          workspaceId={project.workspaceId}
          linked={new Set(relations?.map((r) => r.task.id) ?? [])}
          onClose={() => setPicking(false)}
          onLinked={() => {
            query.reload();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

/** Choose how the tasks relate, then search the workspace for the other task. */
function LinkTaskDialog({
  taskId,
  workspaceId,
  linked,
  onClose,
  onLinked,
}: {
  taskId: string;
  workspaceId: string;
  linked: ReadonlySet<string>;
  onClose: () => void;
  onLinked: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [kind, setKind] = useState<TaskRelationKind>('BLOCKED_BY');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(timer);
  }, [q]);
  const results = useApiQuery<WorkspaceSearchResponse>(
    debounced ? `/workspaces/${workspaceId}/search?q=${encodeURIComponent(debounced)}` : null,
  );
  const tasks = (results.data?.tasks ?? []).filter((t) => t.id !== taskId);

  async function link(otherId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${taskId}/relations`, { body: { kind, taskId: otherId } });
      onLinked();
      dialog.current?.close();
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not link it.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-auto w-full max-w-lg rounded-panel border border-line bg-surface p-0 text-fg shadow-overlay backdrop:bg-fg/40"
    >
      <div className="space-y-3 p-4">
        <h2 id={titleId} className="text-md font-semibold">
          Link a task
        </h2>
        <SegmentedControl
          label="This task"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'BLOCKED_BY', label: 'Is blocked by' },
            { value: 'BLOCKS', label: 'Blocks' },
            { value: 'RELATES', label: 'Relates to' },
          ]}
        />
        <div className="flex items-center gap-2 rounded-control border border-line-control px-2.5 focus-within:border-primary">
          <SearchIcon size={14} className="shrink-0 text-fg-muted" />
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Find a task by key or title"
            placeholder="Find a task by key or title"
            className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-subtle focus-visible:shadow-none! pointer-coarse:h-11 lg:text-sm"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <ul className="max-h-72 overflow-y-auto" aria-label="Matching tasks">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={busy || linked.has(t.id)}
                onClick={() => link(t.id)}
                className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left hover:bg-surface-muted disabled:cursor-default disabled:opacity-50 pointer-coarse:min-h-11"
              >
                <StatusDot status={t.status} />
                <span className="shrink-0 font-mono text-xs text-fg-muted">{t.key}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                {linked.has(t.id) ? (
                  <span className="shrink-0 text-xs text-fg-subtle">Linked</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <p role="status" className="text-sm text-fg-muted empty:hidden">
          {!debounced
            ? 'Type a task key like FF01-2, or words from its title.'
            : results.data && tasks.length === 0
              ? 'No matching tasks.'
              : ''}
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => dialog.current?.close()}>
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
  );
}

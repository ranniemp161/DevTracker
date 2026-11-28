'use client';

import type { TaskChecklistItem } from '@devtrack/types';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MoreIcon } from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';
import { Avatar, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useSession } from '../session/session-context';
import { useProject } from './project-context';
import { rowMenuTrigger } from './property-styles';

const inputClass =
  'h-8 w-full min-w-0 rounded-control border border-line-control bg-surface px-2.5 text-base placeholder:text-fg-subtle focus-visible:border-primary pointer-coarse:h-11 lg:text-sm';

/**
 * A task's checklist (decision record 0018): tick, add, edit, reorder and remove items.
 * Every change saves straight away, like labels and assignees.
 */
export function TaskChecklist({ taskId, onChanged }: { taskId: string; onChanged: () => void }) {
  const { readOnly } = useProject();
  const { user } = useSession();
  const headingId = useId();
  const path = `/tasks/${taskId}/checklist`;
  const query = useApiQuery<{ items: TaskChecklistItem[] }>(path);
  useRealtimeRefresh(
    (e) =>
      e.type === 'task.updated' && e.payload.taskId === taskId && 'checklistItemId' in e.payload,
    query.reload,
  );
  // Optimistic copy, used until the server's next answer replaces the data it was based on.
  const [optimistic, setOptimistic] = useState<{
    basis: unknown;
    items: TaskChecklistItem[];
  } | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const items =
    optimistic && optimistic.basis === query.data ? optimistic.items : query.data?.items;
  const done = items?.filter((i) => i.done).length ?? 0;
  const total = items?.length ?? 0;

  async function run(change: () => Promise<unknown>, preview?: TaskChecklistItem[]) {
    setBusy(true);
    setError(null);
    if (preview) setOptimistic({ basis: query.data, items: preview });
    try {
      await change();
      query.reload();
      onChanged();
    } catch (err) {
      setOptimistic(null);
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    void run(() => api(path, { body: { body } }));
  }

  function toggle(item: TaskChecklistItem) {
    void run(
      () => api(`/checklist-items/${item.id}`, { method: 'PATCH', body: { done: !item.done } }),
      items?.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
    );
  }

  function saveEdit(item: TaskChecklistItem) {
    const body = editing?.body.trim() ?? '';
    setEditing(null);
    if (!body || body === item.body) return;
    void run(
      () => api(`/checklist-items/${item.id}`, { method: 'PATCH', body: { body } }),
      items?.map((i) => (i.id === item.id ? { ...i, body } : i)),
    );
  }

  function move(index: number, delta: -1 | 1) {
    if (!items) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved!);
    void run(
      () => api(`${path}/order`, { method: 'PUT', body: { itemIds: next.map((i) => i.id) } }),
      next,
    );
  }

  function editKeys(e: KeyboardEvent<HTMLInputElement>, item: TaskChecklistItem) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
    }
  }

  // Nothing to show for viewers of an empty checklist.
  if (readOnly && total === 0 && query.data) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center gap-3">
        {/* 0030 §4: the milestone is what we promised; this is how I'll do my part. */}
        <h2 id={headingId} className="text-md font-semibold">
          Your checklist
        </h2>
        {total > 0 ? (
          <>
            <span className="text-sm text-fg-muted tabular-nums">
              {done} of {total}
            </span>
            <span
              role="progressbar"
              aria-label="Checklist progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted"
            >
              <span
                className="block h-full rounded-full bg-status-done transition-[width]"
                style={{ width: `${(done / total) * 100}%` }}
              />
            </span>
          </>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {query.error ? (
        <p className="text-sm text-fg-muted">
          Could not load the checklist.{' '}
          <button type="button" className="underline" onClick={query.reload}>
            Retry
          </button>
        </p>
      ) : !items ? (
        <Skeleton className="h-16" />
      ) : (
        <ul className="-mx-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group/row flex min-h-9 items-center gap-2.5 rounded-control px-2 hover:bg-surface-muted pointer-coarse:min-h-11"
            >
              <input
                type="checkbox"
                checked={item.done}
                disabled={readOnly || busy}
                onChange={() => toggle(item)}
                aria-label={item.body}
                className="size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-default"
              />
              {editing?.id === item.id ? (
                <input
                  autoFocus
                  value={editing.body}
                  maxLength={500}
                  aria-label="Edit checklist item"
                  onChange={(e) => setEditing({ id: item.id, body: e.target.value })}
                  onKeyDown={(e) => editKeys(e, item)}
                  onBlur={() => saveEdit(item)}
                  className={inputClass}
                />
              ) : (
                <span
                  className={`min-w-0 flex-1 text-sm break-words ${item.done ? 'text-fg-subtle line-through' : 'text-fg'}`}
                  onDoubleClick={() =>
                    readOnly ? undefined : setEditing({ id: item.id, body: item.body })
                  }
                >
                  {item.body}
                </span>
              )}
              {item.assignee ? (
                <span title={`@${item.assignee.username}`} className="shrink-0">
                  <Avatar
                    name={item.assignee.username}
                    url={item.assignee.avatarUrl}
                    seed={item.assignee.id}
                    size="xs"
                  />
                  <span className="sr-only">Assigned to @{item.assignee.username}</span>
                </span>
              ) : null}
              {readOnly || editing?.id === item.id ? null : (
                <Menu
                  label={`Actions for "${item.body}"`}
                  align="end"
                  disabled={busy}
                  triggerProps={{ 'aria-label': `Actions for "${item.body}"` }}
                  triggerClassName={rowMenuTrigger}
                  menuClassName="w-44"
                  trigger={<MoreIcon size={16} />}
                >
                  <MenuItem onSelect={() => setEditing({ id: item.id, body: item.body })}>
                    Edit
                  </MenuItem>
                  {item.assignee?.id === user.id ? (
                    <MenuItem
                      onSelect={() =>
                        run(() =>
                          api(`/checklist-items/${item.id}`, {
                            method: 'PATCH',
                            body: { assigneeId: null },
                          }),
                        )
                      }
                    >
                      Unassign me
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onSelect={() =>
                        run(() =>
                          api(`/checklist-items/${item.id}`, {
                            method: 'PATCH',
                            body: { assigneeId: user.id },
                          }),
                        )
                      }
                    >
                      Assign to me
                    </MenuItem>
                  )}
                  {index > 0 ? <MenuItem onSelect={() => move(index, -1)}>Move up</MenuItem> : null}
                  {index < items.length - 1 ? (
                    <MenuItem onSelect={() => move(index, 1)}>Move down</MenuItem>
                  ) : null}
                  <MenuItem
                    onSelect={() =>
                      run(
                        () => api(`/checklist-items/${item.id}`, { method: 'DELETE' }),
                        items.filter((i) => i.id !== item.id),
                      )
                    }
                    className="text-danger! hover:text-danger! focus-visible:text-danger!"
                  >
                    Delete
                  </MenuItem>
                </Menu>
              )}
            </li>
          ))}
        </ul>
      )}

      {readOnly ? null : (
        <form onSubmit={add}>
          <label className="sr-only" htmlFor={`${headingId}-add`}>
            Add a checklist item
          </label>
          <input
            id={`${headingId}-add`}
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an item and press Enter"
            className={inputClass}
          />
        </form>
      )}
    </section>
  );
}

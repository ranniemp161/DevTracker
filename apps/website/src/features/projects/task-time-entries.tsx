'use client';

import type { Task, TimeEntry } from '@devtrack/types';
import { createTimeEntrySchema, MAX_ENTRY_MINUTES } from '@devtrack/validators';
import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRightIcon, MoreIcon, PlusIcon } from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';
import { Avatar, Button, PanelSection, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate, formatMinutes } from './labels';
import { useProject } from './project-context';
import { rowMenuTrigger } from './property-styles';
import { localWorkDate, TaskTimerButton, useTaskTimer } from './task-timer';

const field =
  'h-11 w-full rounded-control border border-line-control bg-surface px-2.5 text-base placeholder:text-fg-subtle focus-visible:border-primary lg:h-8 lg:text-sm';

/**
 * Logged time on the task page, including the total, timer, and manual entries.
 */
export function TaskTimeEntries({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { readOnly } = useProject();
  const query = useApiQuery<{ entries: TimeEntry[] }>(`/tasks/${task.id}/time-entries`);
  const { saved } = useTaskTimer();
  const reloadEntries = query.reload;
  useEffect(() => {
    if (saved?.taskId === task.id) reloadEntries();
  }, [saved, task.id, reloadEntries]);
  // Live updates (M7): entries logged elsewhere show up in this task's activity.
  useRealtimeRefresh(
    (e) => e.type === 'activity.created' && e.payload.taskId === task.id,
    query.reload,
  );
  // `null` = closed, 'new' = logging time, otherwise the id of the entry being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
      query.reload();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  const entries = query.data?.entries;

  return (
    <PanelSection title="Time">
      <p className="text-sm text-fg-secondary">
        <span className="font-semibold text-fg tabular-nums">
          {formatMinutes(task.loggedMinutes)}
        </span>{' '}
        logged
      </p>
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <TaskTimerButton taskId={task.id} />
          {editing !== 'new' ? (
            <Button
              size="sm"
              className="max-lg:min-h-11"
              variant="secondary"
              icon={<PlusIcon size={14} />}
              onClick={() => {
                setError(null);
                setEditing('new');
              }}
            >
              Log time
            </Button>
          ) : null}
        </div>
      ) : null}
      {!readOnly && editing === 'new' ? (
        <EntryForm
          busy={busy}
          onCancel={() => setEditing(null)}
          onError={setError}
          onSubmit={(body) => call(() => api(`/tasks/${task.id}/time-entries`, { body }))}
        />
      ) : null}

      {query.error ? (
        <p className="text-label text-fg-subtle">Could not load the time entries.</p>
      ) : !entries ? (
        <Skeleton className="h-10" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-fg-subtle">No time logged yet.</p>
      ) : (
        // Entries are history: folded, but kept open while one is being edited.
        <details className="group" open={editing !== null && editing !== 'new' ? true : undefined}>
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control text-label text-fg-muted hover:text-fg pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon size={14} className="transition-transform group-open:rotate-90" />
            {entries.length === 1 ? '1 entry' : `${entries.length} entries`}
          </summary>
          <ul className="space-y-2 pt-1">
            {entries.map((entry) =>
              editing === entry.id ? (
                <li key={entry.id}>
                  <EntryForm
                    entry={entry}
                    busy={busy}
                    onCancel={() => setEditing(null)}
                    onError={setError}
                    onSubmit={(body) =>
                      call(() => api(`/time-entries/${entry.id}`, { method: 'PATCH', body }))
                    }
                  />
                </li>
              ) : (
                <li key={entry.id} className="group/row space-y-0.5 text-label">
                  <div className="flex items-center gap-2">
                    <Avatar
                      name={entry.user?.username ?? '?'}
                      url={entry.user?.avatarUrl ?? null}
                      seed={entry.user?.id}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1 truncate text-fg-secondary">
                      {entry.user ? `@${entry.user.username}` : 'Deleted user'}
                      <span className="text-fg-subtle"> · {formatDate(entry.spentOn)}</span>
                    </span>
                    <span className="shrink-0 font-medium text-fg tabular-nums">
                      {formatMinutes(entry.minutes)}
                    </span>
                    {readOnly ? null : (
                      <Menu
                        label={`Time entry from ${formatDate(entry.spentOn)}`}
                        align="end"
                        disabled={busy}
                        triggerProps={{
                          'aria-label': `Actions for the ${formatMinutes(entry.minutes)} entry from ${formatDate(entry.spentOn)}`,
                        }}
                        triggerClassName={rowMenuTrigger}
                        menuClassName="w-36"
                        trigger={<MoreIcon size={16} />}
                      >
                        <MenuItem
                          onSelect={() => {
                            setError(null);
                            setEditing(entry.id);
                          }}
                        >
                          Edit
                        </MenuItem>
                        <MenuItem
                          onSelect={() =>
                            call(() => api(`/time-entries/${entry.id}`, { method: 'DELETE' }))
                          }
                          className="text-danger! hover:text-danger! focus-visible:text-danger!"
                        >
                          Remove
                        </MenuItem>
                      </Menu>
                    )}
                  </div>
                  {entry.note ? <p className="break-words text-fg-muted">{entry.note}</p> : null}
                </li>
              ),
            )}
          </ul>
        </details>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </PanelSection>
  );
}

function EntryForm({
  entry,
  busy,
  onSubmit,
  onCancel,
  onError,
}: {
  entry?: TimeEntry;
  busy: boolean;
  onSubmit: (body: unknown) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [hours, setHours] = useState(entry ? String(Math.floor(entry.minutes / 60)) : '');
  const [minutes, setMinutes] = useState(entry ? String(entry.minutes % 60) : '');
  const [spentOn, setSpentOn] = useState(entry?.spentOn ?? localWorkDate());
  const [note, setNote] = useState(entry?.note ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createTimeEntrySchema.safeParse({
      minutes: Number(hours) * 60 + Number(minutes),
      spentOn,
      note,
    });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Invalid entry.');
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 space-y-1 text-label text-fg-secondary">
          <span>Hours</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_ENTRY_MINUTES / 60}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
            autoFocus
            className={field}
          />
        </label>
        <label className="min-w-0 space-y-1 text-label text-fg-secondary">
          <span>Minutes</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="0"
            className={field}
          />
        </label>
      </div>
      <label className="block space-y-1 text-label text-fg-secondary">
        <span>Date worked</span>
        <input
          type="date"
          value={spentOn}
          onChange={(e) => setSpentOn(e.target.value)}
          className={field}
        />
      </label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note"
        maxLength={500}
        className={field}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy || (!hours && !minutes)}>
          {entry ? 'Save entry' : 'Log time'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

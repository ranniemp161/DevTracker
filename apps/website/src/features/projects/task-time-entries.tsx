'use client';

import type { Task, TimeEntry } from '@devtrack/types';
import { createTimeEntrySchema, parseDuration } from '@devtrack/validators';
import { useState, type FormEvent } from 'react';
import { PlusIcon } from '@/components/icons';
import { Avatar, Button, PanelSection, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate, formatMinutes } from './labels';
import { useProject } from './project-context';

/** Today as a calendar date in the viewer's own time zone. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const field =
  'h-8 w-full rounded-control border border-line-control bg-surface px-2.5 text-sm placeholder:text-fg-subtle focus-visible:border-primary';

/**
 * Logged time on the task page (decision record 0012): the total against the estimate, each
 * entry, and a form to log more. Anyone who can edit the task can change any entry.
 */
export function TaskTimeEntries({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { readOnly } = useProject();
  const query = useApiQuery<{ entries: TimeEntry[] }>(`/tasks/${task.id}/time-entries`);
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
  const over = task.estimateMinutes !== null && task.loggedMinutes > task.estimateMinutes;

  return (
    <PanelSection title="Logged time">
      <p className="text-label text-fg-secondary">
        <span className={`font-medium tabular-nums ${over ? 'text-danger' : 'text-fg'}`}>
          {formatMinutes(task.loggedMinutes)}
        </span>
        {task.estimateMinutes === null
          ? ' logged'
          : ` of ${formatMinutes(task.estimateMinutes)} estimated`}
        {over ? ` · ${formatMinutes(task.loggedMinutes - task.estimateMinutes!)} over` : ''}
      </p>

      {query.error ? (
        <p className="text-label text-fg-subtle">Could not load the time entries.</p>
      ) : !entries ? (
        <Skeleton className="h-10" />
      ) : (
        <ul className="space-y-2">
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
              <li key={entry.id} className="space-y-0.5 text-label">
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
                </div>
                {entry.note ? <p className="break-words text-fg-muted">{entry.note}</p> : null}
                {readOnly ? null : (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Edit the ${formatMinutes(entry.minutes)} entry from ${formatDate(entry.spentOn)}`}
                      onClick={() => {
                        setError(null);
                        setEditing(entry.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Remove the ${formatMinutes(entry.minutes)} entry from ${formatDate(entry.spentOn)}`}
                      onClick={() =>
                        call(() => api(`/time-entries/${entry.id}`, { method: 'DELETE' }))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
          {entries.length === 0 ? (
            <li className="text-sm text-fg-subtle">No time logged yet.</li>
          ) : null}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {readOnly ? null : editing === 'new' ? (
        <EntryForm
          busy={busy}
          onCancel={() => setEditing(null)}
          onError={setError}
          onSubmit={(body) => call(() => api(`/tasks/${task.id}/time-entries`, { body }))}
        />
      ) : (
        <Button
          size="sm"
          variant="ghost"
          icon={<PlusIcon size={14} />}
          onClick={() => {
            setError(null);
            setEditing('new');
          }}
        >
          Log time
        </Button>
      )}
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
  const [duration, setDuration] = useState(entry ? formatMinutes(entry.minutes) : '');
  const [spentOn, setSpentOn] = useState(entry?.spentOn ?? today());
  const [note, setNote] = useState(entry?.note ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createTimeEntrySchema.safeParse({
      minutes: parseDuration(duration) ?? undefined,
      spentOn,
      note,
    });
    if (!parsed.success) return onError(parsed.error.issues[0]?.message ?? 'Invalid entry.');
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder="1h 30m"
          aria-label="Time spent"
          autoFocus
          className={field}
        />
        <input
          type="date"
          value={spentOn}
          onChange={(e) => setSpentOn(e.target.value)}
          aria-label="Date worked"
          className={field}
        />
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note"
        maxLength={500}
        className={field}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy || !duration.trim()}>
          {entry ? 'Save entry' : 'Log time'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

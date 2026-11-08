'use client';

import type { Milestone, MilestoneCriterion } from '@devtrack/types';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PlusIcon, XIcon } from '@/components/icons';
import { Button, IconButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/**
 * Task progress from real counts only (SPEC R3): "N of M tasks" and a bar, or "No tasks yet".
 * Links to the milestone's tasks in the list view.
 */
export function MilestoneProgress({
  milestone: m,
  projectId,
}: {
  milestone: Milestone;
  projectId: string;
}) {
  const { total, done } = m.taskCounts;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
        <span>{total === 0 ? 'No tasks yet' : `${done} of ${total} tasks done`}</span>
        <span className="flex items-center gap-3">
          {total > 0 ? <span>{pct}%</span> : null}
          <Link
            href={`/projects/${projectId}/list?milestoneId=${m.id}`}
            className="font-medium text-fg-secondary hover:text-fg hover:underline"
          >
            View tasks
          </Link>
        </span>
      </div>
      {total > 0 ? (
        <div
          role="progressbar"
          aria-label={`${m.name} task progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full bg-status-done" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The milestone's acceptance criteria: what must be true for the deliverable to be done.
 * Everyone on the project can read them; workspace admins add, check and remove them.
 */
export function MilestoneCriteria({
  milestone: m,
  canManage,
  onChanged,
}: {
  milestone: Milestone;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const met = m.criteria.filter((c) => c.done).length;

  async function call(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
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

  function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    void call(
      () => api(`/milestones/${m.id}/criteria`, { body: { text } }),
      () => setText(''),
    );
  }

  if (m.criteria.length === 0 && !canManage) return null;

  return (
    <section aria-label={`${m.name} acceptance criteria`} className="mt-4 space-y-2">
      <h3 className="text-label font-medium text-fg-secondary">
        Acceptance criteria
        {m.criteria.length > 0 ? (
          <span className="font-normal text-fg-muted">
            {' '}
            · {met} of {m.criteria.length} met
          </span>
        ) : null}
      </h3>
      {m.criteria.length > 0 ? (
        <ul className="space-y-1">
          {m.criteria.map((c) => (
            <CriterionRow
              key={c.id}
              criterion={c}
              canManage={canManage}
              busy={busy}
              onToggle={(done) =>
                call(() => api(`/milestone-criteria/${c.id}`, { method: 'PATCH', body: { done } }))
              }
              onRemove={() => call(() => api(`/milestone-criteria/${c.id}`, { method: 'DELETE' }))}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">
          Add what must be true for this milestone to count as delivered.
        </p>
      )}
      {canManage ? (
        <form onSubmit={add} className="flex items-center gap-2">
          <label htmlFor={`criterion-${m.id}`} className="sr-only">
            New acceptance criterion
          </label>
          <input
            id={`criterion-${m.id}`}
            value={text}
            maxLength={500}
            placeholder="e.g. Users can reset their password by email"
            onChange={(e) => setText(e.target.value)}
            className="block h-7.5 min-w-0 flex-1 rounded-control border border-line-control bg-surface px-2.5 text-label text-fg transition-colors placeholder:text-fg-subtle focus-visible:border-primary"
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || !text.trim()}
            icon={<PlusIcon size={14} />}
          >
            Add
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}

function CriterionRow({
  criterion: c,
  canManage,
  busy,
  onToggle,
  onRemove,
}: {
  criterion: MilestoneCriterion;
  canManage: boolean;
  busy: boolean;
  onToggle: (done: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-control px-1 py-0.5 hover:bg-surface-sunken">
      <input
        id={`criterion-check-${c.id}`}
        type="checkbox"
        className="mt-0.5 accent-primary"
        checked={c.done}
        disabled={!canManage || busy}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <label htmlFor={`criterion-check-${c.id}`} className="min-w-0 flex-1 text-sm">
        <span className={c.done ? 'text-fg-muted line-through' : 'text-fg'}>{c.text}</span>
        {c.done && c.doneAt ? (
          <span className="block text-xs text-fg-subtle">
            Met {new Date(c.doneAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            {c.doneBy ? ` · checked by @${c.doneBy.username}` : ''}
          </span>
        ) : null}
      </label>
      {canManage ? (
        <IconButton
          size="sm"
          aria-label={`Remove criterion: ${c.text}`}
          disabled={busy}
          onClick={onRemove}
        >
          <XIcon size={14} />
        </IconButton>
      ) : null}
    </li>
  );
}

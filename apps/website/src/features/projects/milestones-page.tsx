'use client';

import type { Milestone } from '@devtrack/types';
import { createMilestoneSchema } from '@devtrack/validators';
import { useState } from 'react';
import { FlagIcon, CheckIcon } from '@/components/icons';
import { Alert, Button, EmptyState, Field, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useAuthForm, withoutBlanks } from '../auth/use-auth-form';
import { formatDate } from './labels';
import { useProject } from './project-context';

export function MilestonesPage() {
  const { project, readOnly } = useProject();
  const canManage = project.viewerCanManage && !readOnly;
  const milestones = useApiQuery<Milestone[]>(`/projects/${project.id}/milestones`);
  const open = milestones.data?.filter((m) => m.status !== 'COMPLETED') ?? [];
  const completed = milestones.data?.filter((m) => m.status === 'COMPLETED') ?? [];

  return (
    <div className="space-y-7">
      {canManage ? <CreateMilestone onCreated={milestones.reload} /> : null}
      {milestones.error ? <Alert>{milestones.error.message}</Alert> : null}
      <MilestoneSection
        title="Open"
        items={open}
        empty="No open milestones."
        canManage={canManage}
        onChanged={milestones.reload}
      />
      <MilestoneSection
        title="Completed"
        items={completed}
        empty="Completed milestones will show up here."
        canManage={canManage}
        onChanged={milestones.reload}
      />
    </div>
  );
}

function MilestoneSection({
  title,
  items,
  empty,
  canManage,
  onChanged,
}: {
  title: string;
  items: Milestone[];
  empty: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-md font-semibold text-fg">
        {title} · {items.length}
      </h2>
      {items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <MilestoneRow key={m.id} milestone={m} canManage={canManage} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MilestoneRow({
  milestone: m,
  canManage,
  onChanged,
}: {
  milestone: Milestone;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  const completed = m.status === 'COMPLETED';
  return (
    <li className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-surface p-4">
      <FlagIcon
        size={18}
        className={`mt-0.5 shrink-0 ${completed ? 'text-status-done' : 'text-fg-subtle'}`}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-lg font-semibold ${completed ? 'text-fg-muted' : 'text-fg'}`}>
          {m.name}
        </p>
        {m.description ? <p className="mt-0.5 text-sm text-fg-muted">{m.description}</p> : null}
        {m.dueDate ? (
          <p className={`mt-1.5 text-xs ${dueTone(m.dueDate, completed)}`}>
            {dueLabel(m.dueDate, completed)}
          </p>
        ) : null}
        {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
      </div>
      {canManage ? (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              call(() =>
                api(`/milestones/${m.id}`, {
                  method: 'PATCH',
                  body: { status: completed ? 'OPEN' : 'COMPLETED' },
                }),
              )
            }
          >
            {completed ? null : <CheckIcon size={14} />}
            {completed ? 'Reopen' : 'Mark complete'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => call(() => api(`/milestones/${m.id}`, { method: 'DELETE' }))}
          >
            Delete
          </Button>
        </>
      ) : null}
    </li>
  );
}

/** Calendar-date difference in days between a YYYY-MM-DD string and today (local). */
function daysUntil(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const target = Date.UTC(y!, m! - 1, d!);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

function dueTone(iso: string, completed: boolean) {
  if (completed) return 'text-fg-muted';
  const days = daysUntil(iso);
  if (days < 0) return 'font-medium text-danger';
  if (days <= 2) return 'font-medium text-warning-fg';
  return 'text-fg-muted';
}

function dueLabel(iso: string, completed: boolean) {
  if (!completed && daysUntil(iso) < 0) return `Overdue · ${formatDate(iso)}`;
  return `Due ${formatDate(iso)}`;
}

function CreateMilestone({ onCreated }: { onCreated: () => void }) {
  const { project } = useProject();
  const form = useAuthForm(
    withoutBlanks(createMilestoneSchema),
    { name: '', description: '', dueDate: '' },
    async (values) => {
      await api(`/projects/${project.id}/milestones`, { body: values });
      onCreated();
    },
  );
  return (
    <section
      aria-label="New milestone"
      className="rounded-panel border border-line-control bg-surface p-5 shadow-raised"
    >
      <form
        onSubmit={form.onSubmit}
        noValidate
        className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end"
      >
        <Field
          label="Name"
          name="name"
          value={form.values.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <Field
          label="Description"
          name="description"
          value={form.values.description}
          onChange={form.onChange}
          error={form.fieldErrors.description}
        />
        <Field
          label="Due date"
          name="dueDate"
          type="date"
          value={form.values.dueDate}
          onChange={form.onChange}
          error={form.fieldErrors.dueDate}
        />
        <div className="w-28">
          <SubmitButton pending={form.pending}>Add</SubmitButton>
        </div>
      </form>
      {form.formError ? (
        <div className="mt-3">
          <Alert>{form.formError}</Alert>
        </div>
      ) : null}
    </section>
  );
}

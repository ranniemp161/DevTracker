'use client';

import type { Milestone } from '@devtrack/types';
import { createMilestoneSchema } from '@devtrack/validators';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Skeleton,
  SubmitButton,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useAuthForm, withoutBlanks } from '../auth/use-auth-form';
import { formatDate } from './labels';
import { useProject } from './project-context';

export function MilestonesPage() {
  const { project, readOnly } = useProject();
  const canManage = project.viewerCanManage && !readOnly;
  const milestones = useApiQuery<Milestone[]>(`/projects/${project.id}/milestones`);

  return (
    <div className="space-y-6">
      {canManage ? <CreateMilestone onCreated={milestones.reload} /> : null}
      <Card title="Milestones">
        {milestones.error ? <Alert>{milestones.error.message}</Alert> : null}
        {!milestones.data && !milestones.error ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : null}
        {milestones.data?.length === 0 ? (
          <EmptyState
            title="No milestones yet"
            description="Milestones help track high-level release goals and delivery targets."
          />
        ) : null}
        {milestones.data && milestones.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {milestones.data.map((m) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                canManage={canManage}
                onChanged={milestones.reload}
              />
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
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
    <li className="flex flex-wrap items-start justify-between gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={`font-semibold text-sm ${completed ? 'text-mineral line-through' : 'text-graphite'}`}
          >
            {m.name}
          </p>
          <Badge tone={completed ? 'green' : 'teal'}>{completed ? 'Completed' : 'Open'}</Badge>
        </div>
        {m.description ? (
          <p className="mt-1 text-xs text-mineral leading-relaxed">{m.description}</p>
        ) : null}
        <p className="mt-1.5 text-xs text-mineral-muted font-medium">Due {formatDate(m.dueDate)}</p>
        {error ? <p className="mt-1.5 text-xs text-red-600 font-medium">{error}</p> : null}
      </div>

      {canManage ? (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="xs"
            variant="secondary"
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
            {completed ? 'Reopen' : 'Mark complete'}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => call(() => api(`/milestones/${m.id}`, { method: 'DELETE' }))}
            className="text-red-700 hover:bg-red-50"
          >
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
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
    <Card title="New milestone">
      <form
        onSubmit={form.onSubmit}
        noValidate
        className="grid gap-3 sm:grid-cols-[1fr_1fr_160px_auto] sm:items-end"
      >
        <Field
          label="Name"
          name="name"
          placeholder="e.g. v1.0 Launch"
          value={form.values.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <Field
          label="Description"
          name="description"
          placeholder="Optional goals and scope"
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
    </Card>
  );
}

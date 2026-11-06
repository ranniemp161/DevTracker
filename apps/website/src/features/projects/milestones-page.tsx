'use client';

import type { Milestone } from '@devtrack/types';
import { createMilestoneSchema } from '@devtrack/validators';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Field, SubmitButton } from '@/components/ui';
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
        {milestones.data?.length === 0 ? (
          <p className="text-sm text-neutral-500">No milestones yet.</p>
        ) : null}
        <ul className="divide-y divide-neutral-100">
          {milestones.data?.map((m) => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              canManage={canManage}
              onChanged={milestones.reload}
            />
          ))}
        </ul>
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
    <li className="flex flex-wrap items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${completed ? 'text-neutral-500 line-through' : ''}`}>
          {m.name}
        </p>
        {m.description ? <p className="mt-0.5 text-sm text-neutral-600">{m.description}</p> : null}
        <p className="mt-1 text-xs text-neutral-500">Due {formatDate(m.dueDate)}</p>
        {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
      </div>
      <Badge tone={completed ? 'green' : 'blue'}>{completed ? 'Completed' : 'Open'}</Badge>
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
    </Card>
  );
}

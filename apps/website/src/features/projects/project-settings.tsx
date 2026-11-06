'use client';

import { updateProjectSchema } from '@devtrack/validators';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Card, Field, Select, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthForm } from '../auth/use-auth-form';
import { ProjectRepositories } from '../github/project-repositories';
import { PROJECT_STATUS_LABEL } from './labels';
import { useProject } from './project-context';

export function ProjectSettings() {
  const { project, readOnly } = useProject();
  if (!project.viewerCanManage)
    return <Alert>Only workspace admins can change project settings.</Alert>;
  if (readOnly) return <Alert tone="info">Archived projects cannot be edited.</Alert>;
  return (
    <div className="space-y-6">
      <GeneralCard />
      <ProjectRepositories />
      <ArchiveCard />
    </div>
  );
}

/** Blank date inputs mean "clear the date" (null), which the shared schema accepts. */
const settingsSchema = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const values = v as Record<string, string>;
  return { ...values, startDate: values.startDate || null, targetDate: values.targetDate || null };
}, updateProjectSchema);

function GeneralCard() {
  const { project, reload } = useProject();
  const [saved, setSaved] = useState(false);
  const form = useAuthForm(
    settingsSchema,
    {
      name: project.name,
      description: project.description ?? '',
      status: project.status,
      startDate: project.startDate ?? '',
      targetDate: project.targetDate ?? '',
    },
    async (values) => {
      setSaved(false);
      await api(`/projects/${project.id}`, { method: 'PATCH', body: values });
      setSaved(true);
      reload();
    },
  );

  const v = form.values;

  return (
    <Card title="General" description={`The project key (${project.key}) cannot be changed.`}>
      <form onSubmit={form.onSubmit} noValidate className="max-w-lg space-y-4">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        {saved ? <Alert tone="success">Saved.</Alert> : null}
        <Field
          label="Name"
          name="name"
          value={v.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <Field
          label="Description"
          name="description"
          value={v.description}
          onChange={form.onChange}
          error={form.fieldErrors.description}
        />
        <Select label="Status" name="status" value={v.status} onChange={form.onChange}>
          {(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as const).map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Start date"
            name="startDate"
            type="date"
            value={v.startDate}
            onChange={form.onChange}
            error={form.fieldErrors.startDate}
          />
          <Field
            label="Target date"
            name="targetDate"
            type="date"
            value={v.targetDate}
            onChange={form.onChange}
            error={form.fieldErrors.targetDate}
          />
        </div>
        <div className="w-40">
          <SubmitButton pending={form.pending}>Save</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function ArchiveCard() {
  const router = useRouter();
  const { project } = useProject();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.id}`, { method: 'DELETE' });
      router.push(`/workspaces/${project.workspaceId}/projects`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive the project.');
      setBusy(false);
    }
  }

  return (
    <Card
      title="Archive project"
      description="Archived projects become read-only and are hidden from the project list."
    >
      <div className="max-w-md space-y-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field
          label={`Type ${project.key} to confirm`}
          name="confirm"
          value={confirm}
          autoComplete="off"
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button variant="danger" disabled={busy || confirm !== project.key} onClick={archive}>
          Archive project
        </Button>
      </div>
    </Card>
  );
}

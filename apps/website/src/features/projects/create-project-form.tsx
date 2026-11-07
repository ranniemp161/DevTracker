'use client';

import type { Project } from '@devtrack/types';
import { createProjectSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Field, SubmitButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthForm, withoutBlanks } from '../auth/use-auth-form';
import { useWorkspace } from '../workspaces/workspace-context';

export function CreateProjectForm() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const form = useAuthForm(
    withoutBlanks(createProjectSchema),
    { name: '', key: '', description: '', startDate: '', targetDate: '' },
    async (values) => {
      const { project } = await api<{ project: Project }>(`/workspaces/${workspace.id}/projects`, {
        body: values,
      });
      router.push(`/projects/${project.id}`);
    },
  );

  const set = form.values;

  return (
    <div className="max-w-lg">
      <Link
        href={`/workspaces/${workspace.id}/projects`}
        className="text-sm text-fg-muted hover:underline"
      >
        ← Projects
      </Link>
      <h2 className="mt-2 text-xl font-semibold">New project</h2>
      <form onSubmit={form.onSubmit} noValidate className="mt-6 space-y-4">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        <Field
          label="Name"
          name="name"
          value={set.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <Field
          label="Key"
          name="key"
          value={set.key}
          onChange={form.onChange}
          error={form.fieldErrors.key}
          hint="2–10 letters or digits, e.g. DEV. Task keys look like DEV-104. It cannot be changed later."
          className="uppercase"
        />
        <Field
          label="Description"
          name="description"
          value={set.description}
          onChange={form.onChange}
          error={form.fieldErrors.description}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Start date"
            name="startDate"
            type="date"
            value={set.startDate}
            onChange={form.onChange}
            error={form.fieldErrors.startDate}
          />
          <Field
            label="Target date"
            name="targetDate"
            type="date"
            value={set.targetDate}
            onChange={form.onChange}
            error={form.fieldErrors.targetDate}
          />
        </div>
        <SubmitButton pending={form.pending}>Create project</SubmitButton>
      </form>
    </div>
  );
}

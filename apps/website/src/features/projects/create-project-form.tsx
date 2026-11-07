'use client';

import type { Project } from '@devtrack/types';
import { createProjectSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, Field, SubmitButton } from '@/components/ui';
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
    <div className="mx-auto max-w-xl space-y-4">
      <Link
        href={`/workspaces/${workspace.id}/projects`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-mineral hover:text-graphite transition-colors"
      >
        <svg aria-hidden="true" className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
            clipRule="evenodd"
          />
        </svg>
        Projects
      </Link>
      <Card
        title="Create a new project"
        description="A project organizes tasks into Kanban and list views, manages milestones, and connects GitHub repositories."
      >
        <form onSubmit={form.onSubmit} noValidate className="space-y-4 pt-1">
          {form.formError ? <Alert tone="error">{form.formError}</Alert> : null}
          <Field
            label="Name"
            name="name"
            placeholder="e.g. Core API Redesign"
            value={set.name}
            onChange={form.onChange}
            error={form.fieldErrors.name}
          />
          <Field
            label="Project key"
            name="key"
            placeholder="e.g. API"
            value={set.key}
            onChange={form.onChange}
            error={form.fieldErrors.key}
            hint="2–10 uppercase letters or numbers. Task keys are prefixed with this key (e.g. API-12)."
            className="uppercase"
          />
          <Field
            label="Description"
            name="description"
            placeholder="Optional project scope and objectives"
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
          <div className="pt-2">
            <SubmitButton pending={form.pending}>Create project</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

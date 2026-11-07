'use client';

import type { WorkspaceSummary } from '@devtrack/types';
import { createWorkspaceSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, Field, SubmitButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuthForm } from '../auth/use-auth-form';
import { useSession } from '../session/session-context';

export function CreateWorkspaceForm() {
  const router = useRouter();
  const { reloadWorkspaces } = useSession();
  const form = useAuthForm(createWorkspaceSchema, { name: '' }, async (values) => {
    const { workspace } = await api<{ workspace: WorkspaceSummary }>('/workspaces', {
      body: values,
    });
    reloadWorkspaces();
    router.push(`/workspaces/${workspace.id}`);
  });

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-mineral hover:text-graphite transition-colors"
      >
        <svg aria-hidden="true" className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
            clipRule="evenodd"
          />
        </svg>
        Workspaces
      </Link>
      <Card
        title="Create a new workspace"
        description="A workspace contains your team members, engineering projects, and GitHub installations."
      >
        <form onSubmit={form.onSubmit} noValidate className="space-y-4 pt-1">
          {form.formError ? <Alert tone="error">{form.formError}</Alert> : null}
          <Field
            label="Workspace name"
            name="name"
            autoFocus
            placeholder="e.g. Acme Engineering"
            value={form.values.name}
            onChange={form.onChange}
            error={form.fieldErrors.name}
          />
          <div className="pt-2">
            <SubmitButton pending={form.pending}>Create workspace</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}

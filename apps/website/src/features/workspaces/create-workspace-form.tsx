'use client';

import type { WorkspaceSummary } from '@devtrack/types';
import { createWorkspaceSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Field, SubmitButton } from '@/components/ui';
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
    <div className="mx-auto max-w-md">
      <Link href="/" className="text-sm text-fg-muted hover:underline">
        ← Workspaces
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">New workspace</h1>
      <p className="mt-1 text-sm text-fg-muted">
        A workspace holds your team, projects and GitHub connections. You will be its owner.
      </p>
      <form onSubmit={form.onSubmit} noValidate className="mt-6 space-y-4">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        <Field
          label="Workspace name"
          name="name"
          autoFocus
          placeholder="Acme Engineering"
          value={form.values.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <SubmitButton pending={form.pending}>Create workspace</SubmitButton>
      </form>
    </div>
  );
}

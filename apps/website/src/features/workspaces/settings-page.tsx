'use client';

import type { WorkspaceDetails } from '@devtrack/types';
import { updateWorkspaceSchema } from '@devtrack/validators';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthForm } from '../auth/use-auth-form';
import { useSession } from '../session/session-context';
import { isAdmin } from './permissions';
import { useWorkspace } from './workspace-context';

export function SettingsPage() {
  const { workspace } = useWorkspace();
  if (!isAdmin(workspace.role)) {
    return <Alert>Only workspace admins can change settings.</Alert>;
  }
  return (
    <div className="space-y-6">
      <RenameCard />
      {workspace.role === 'OWNER' ? <ArchiveCard /> : null}
    </div>
  );
}

function RenameCard() {
  const { workspace, reload } = useWorkspace();
  const { reloadWorkspaces } = useSession();
  const [saved, setSaved] = useState(false);
  const form = useAuthForm(updateWorkspaceSchema, { name: workspace.name }, async (values) => {
    setSaved(false);
    await api<{ workspace: WorkspaceDetails }>(`/workspaces/${workspace.id}`, {
      method: 'PATCH',
      body: values,
    });
    setSaved(true);
    reload();
    reloadWorkspaces();
  });

  return (
    <Card title="General" description={`The workspace slug (${workspace.slug}) does not change.`}>
      <form onSubmit={form.onSubmit} noValidate className="max-w-md space-y-4">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        {saved ? <Alert tone="success">Saved.</Alert> : null}
        <Field
          label="Workspace name"
          name="name"
          value={form.values.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <div className="w-40">
          <SubmitButton pending={form.pending}>Save</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function ArchiveCard() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const { reloadWorkspaces } = useSession();
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api(`/workspaces/${workspace.id}`, { method: 'DELETE' });
      reloadWorkspaces();
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive the workspace.');
      setBusy(false);
    }
  }

  return (
    <Card
      title="Archive workspace"
      description="Archiving hides the workspace from every member. Only the owner can do this."
    >
      <div className="max-w-md space-y-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field
          label={`Type "${workspace.name}" to confirm`}
          name="confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
        <Button
          variant="danger"
          disabled={busy || confirmText !== workspace.name}
          onClick={archive}
        >
          Archive workspace
        </Button>
      </div>
    </Card>
  );
}

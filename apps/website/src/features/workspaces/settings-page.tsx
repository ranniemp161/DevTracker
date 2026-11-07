'use client';

import type { WorkspaceDetails } from '@devtrack/types';
import { updateWorkspaceSchema } from '@devtrack/validators';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Card, Field, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthForm } from '../auth/use-auth-form';
import { useSession } from '../session/session-context';
import { GithubSettings } from '../github/github-settings';
import { LabelsSettings } from './labels-settings';
import { isAdmin } from './permissions';
import { useWorkspace } from './workspace-context';

export function SettingsPage() {
  const { workspace } = useWorkspace();
  if (!isAdmin(workspace.role)) {
    return <Alert tone="warning">Only workspace admins can change settings.</Alert>;
  }
  return (
    <div className="space-y-6">
      <RenameCard />
      <LabelsSettings />
      {/* GithubSettings reads ?github= via useSearchParams, which needs a Suspense boundary. */}
      <Suspense>
        <GithubSettings />
      </Suspense>
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
        {form.formError ? <Alert tone="error">{form.formError}</Alert> : null}
        {saved ? <Alert tone="success">Workspace name updated.</Alert> : null}
        <Field
          label="Workspace name"
          name="name"
          value={form.values.name}
          onChange={(e) => {
            setSaved(false);
            form.onChange(e);
          }}
          error={form.fieldErrors.name}
        />
        <div className="w-40 pt-1">
          <SubmitButton pending={form.pending}>Save changes</SubmitButton>
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
      description="Archiving hides the workspace from every member. Only the owner can perform this action."
      className="border-red-200/80"
    >
      <div className="max-w-md space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label={`Type "${workspace.name}" to confirm`}
          name="confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
        />
        <Button
          variant="danger"
          size="sm"
          disabled={busy || confirmText !== workspace.name}
          onClick={archive}
        >
          {busy ? 'Archiving…' : 'Archive workspace'}
        </Button>
      </div>
    </Card>
  );
}

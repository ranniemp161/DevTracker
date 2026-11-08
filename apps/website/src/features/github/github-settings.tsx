'use client';

import type {
  GithubInstallation,
  GithubInstallationList,
  AvailableGithubInstallation,
  GithubRepositoryAccess,
} from '@devtrack/types';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Select, SettingsSection } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useWorkspace } from '../workspaces/workspace-context';
import { githubErrorMessage } from './error-messages';

const STATUS: Record<
  GithubInstallation['status'],
  { label: string; tone: 'green' | 'amber' | 'red' }
> = {
  ACTIVE: { label: 'Active', tone: 'green' },
  SUSPENDED: { label: 'Suspended', tone: 'amber' },
  REMOVED: { label: 'Removed', tone: 'red' },
};

/**
 * Workspace Settings → GitHub (admins only). Installing is a full-page navigation through the
 * API, which redirects to GitHub and back here with `?github=` or `?githubError=`.
 */
export function GithubSettings() {
  const { workspace } = useWorkspace();
  const params = useSearchParams();
  const query = useApiQuery<GithubInstallationList>(
    `/github/installations?workspaceId=${workspace.id}`,
  );
  const outcome = params.get('github');
  const errorCode = params.get('githubError');
  const installHref = `/api/v1/github/install?workspaceId=${encodeURIComponent(workspace.id)}`;

  return (
    <SettingsSection
      id="github"
      title="GitHub"
      description="Connect a GitHub account or organization, choose which repositories this workspace can use, then connect them to projects. The same installation can serve several workspaces with separate repository access."
      actions={
        query.data?.appConfigured ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={`${installHref}&mode=connect`}
              className="inline-flex items-center rounded-control border border-line-control bg-surface px-3.5 py-2 text-sm font-medium text-fg hover:bg-surface-sunken"
            >
              Connect existing installation
            </a>
            <a
              href={installHref}
              className="inline-flex items-center rounded-control bg-fg px-3.5 py-2 text-sm font-medium whitespace-nowrap text-fg-on-inverse hover:bg-fg-secondary"
            >
              Install on GitHub
            </a>
          </div>
        ) : null
      }
    >
      <div className="space-y-3">
        {outcome === 'installed' ? (
          <Alert tone="success">
            GitHub connected. Choose repository access below before connecting repositories to
            projects.
          </Alert>
        ) : null}
        {outcome === 'choose' ? (
          <ExistingInstallationPicker workspaceId={workspace.id} onConnected={query.reload} />
        ) : null}
        {outcome === 'requested' ? (
          <Alert tone="info">
            Installation requested. An owner of the GitHub organization must approve it; then start
            the installation here again.
          </Alert>
        ) : null}
        {errorCode ? <Alert>{githubErrorMessage(errorCode)}</Alert> : null}
        {query.error ? <Alert>{query.error.message}</Alert> : null}
        {query.data && !query.data.appConfigured ? (
          <Alert tone="info">
            The GitHub App is not configured on this server yet. Ask whoever runs DevTrack to set
            the GITHUB_APP_* variables.
          </Alert>
        ) : null}
        {query.data?.installations.length === 0 && query.data.appConfigured ? (
          <p className="text-sm text-fg-subtle">No GitHub connections yet.</p>
        ) : null}
        <ul className="divide-y divide-line-subtle">
          {query.data?.installations.map((i) => (
            <ConnectionRow key={i.id} installation={i} onChanged={query.reload} />
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}

function ExistingInstallationPicker({
  workspaceId,
  onConnected,
}: {
  workspaceId: string;
  onConnected: () => void;
}) {
  const query = useApiQuery<AvailableGithubInstallation[]>(
    `/github/available-installations?workspaceId=${workspaceId}`,
  );
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api('/github/connections', {
        body: { workspaceId, githubInstallationId: Number(selected) },
      });
      setDone(true);
      onConnected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect GitHub.');
    } finally {
      setBusy(false);
    }
  }
  if (done) return <Alert tone="success">GitHub connected. Choose repository access below.</Alert>;
  return (
    <form onSubmit={connect} className="space-y-3">
      {query.error ? <Alert>{query.error.message}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {query.loading ? (
        <p className="text-sm text-fg-muted">Loading verified GitHub installations...</p>
      ) : null}
      {query.data?.length === 0 ? (
        <Alert tone="info">
          No verified installations are available. Install the App on GitHub, or connect again if
          your authorization expired.
        </Alert>
      ) : null}
      {query.data?.length ? (
        <>
          <Select
            label="GitHub account or organization"
            name="existing-github-installation"
            value={selected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a verified installation</option>
            {query.data.map((i) => (
              <option key={i.githubInstallationId} value={i.githubInstallationId}>
                {i.accountLogin} ({i.accountType})
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" loading={busy} disabled={!selected}>
            Connect to this workspace
          </Button>
        </>
      ) : null}
    </form>
  );
}

function ConnectionRow({
  installation: i,
  onChanged,
}: {
  installation: GithubInstallation;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api(`/github/installations/${i.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect GitHub.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{i.accountLogin}</p>
          <p className="text-xs text-fg-subtle">
            {i.accountType} | connected{' '}
            {new Date(i.installedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            {i.installedBy ? ` | GitHub access verified by @${i.installedBy.username}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
          <Button
            size="sm"
            disabled={i.status !== 'ACTIVE' || busy || confirming}
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
          >
            Repository access
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
            Disconnect workspace
          </Button>
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">
            Disconnect {i.accountLogin} from this workspace and its projects? Past activity stays
            available. Other workspaces and the GitHub App installation stay connected.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy} onClick={disconnect}>
              Disconnect this workspace
            </Button>
            <Button size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : editing ? (
        <RepositoryAccessEditor connectionId={i.id} />
      ) : null}
    </li>
  );
}

function RepositoryAccessEditor({ connectionId }: { connectionId: string }) {
  const [saved, setSaved] = useState(false);
  const query = useApiQuery<GithubRepositoryAccess[]>(
    `/github/installations/${connectionId}/repository-access`,
  );
  if (query.error) return <Alert>{query.error.message}</Alert>;
  if (!query.data) return <p className="text-sm text-fg-muted">Loading repository access...</p>;
  return (
    <div className="space-y-3">
      {saved ? <Alert tone="success">Repository access saved.</Alert> : null}
      <RepositoryAccessForm
        key={JSON.stringify(query.data)}
        connectionId={connectionId}
        repositories={query.data}
        onSaved={() => {
          setSaved(true);
          query.reload();
        }}
      />
    </div>
  );
}

function RepositoryAccessForm({
  connectionId,
  repositories,
  onSaved,
}: {
  connectionId: string;
  repositories: GithubRepositoryAccess[];
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState(
    () => new Set(repositories.filter((r) => r.allowed).map((r) => r.githubRepositoryId)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removedInUse = repositories.some(
    (r) => r.allowed && !selected.has(r.githubRepositoryId) && r.connectedProjectIds.length,
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/github/installations/${connectionId}/repository-access`, {
        method: 'PUT',
        body: { githubRepositoryIds: [...selected] },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save repository access.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-3" onSubmit={save}>
      <p className="text-sm text-fg-muted">
        Only checked repositories can be connected to projects in this workspace. Connect the
        installation again to refresh repositories verified through your GitHub account.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Repositories allowed in this workspace</legend>
        {repositories.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            No repositories are available. Check your GitHub access, then reconnect this
            installation.
          </p>
        ) : null}
        {repositories.map((r) => (
          <label key={r.githubRepositoryId} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={selected.has(r.githubRepositoryId)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(r.githubRepositoryId);
                else next.delete(r.githubRepositoryId);
                setSelected(next);
              }}
            />
            <span>
              <span className="font-mono">{r.fullName}</span>
              <span className="ml-2 text-xs text-fg-subtle">
                {r.visibility}
                {r.connectedProjectIds.length
                  ? ` | ${r.connectedProjectIds.length} connected project(s)`
                  : ''}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {removedInUse ? (
        <Alert tone="info">
          Saving will disconnect unchecked repositories from projects in this workspace. Past
          activity is retained.
        </Alert>
      ) : null}
      <Button type="submit" size="sm" variant="primary" loading={busy}>
        Save repository access
      </Button>
    </form>
  );
}

'use client';

import type {
  AvailableRepository,
  ConnectedRepository,
  GithubInstallationList,
} from '@devtrack/types';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from '../projects/project-context';

/** Project Settings → Repositories (workspace admins). */
export function ProjectRepositories() {
  const { project } = useProject();
  const connected = useApiQuery<ConnectedRepository[]>(`/projects/${project.id}/repositories`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disconnect(repo: ConnectedRepository) {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/repositories/${repo.id}`, { method: 'DELETE' });
      connected.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect the repository.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Repositories"
      description="GitHub activity from connected repositories will appear in this project. Disconnecting keeps past activity."
    >
      <div className="space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        {connected.error ? <Alert>{connected.error.message}</Alert> : null}
        {connected.data?.length === 0 ? (
          <p className="text-sm text-neutral-500">No repositories connected yet.</p>
        ) : null}
        <ul className="divide-y divide-neutral-100">
          {connected.data?.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-sm font-medium hover:underline"
                >
                  {r.fullName}
                </a>
                <p className="text-xs text-neutral-500">
                  {r.visibility} · default branch {r.defaultBranch}
                  {r.connectedBy ? ` · connected by @${r.connectedBy.username}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.installationStatus !== 'ACTIVE' ? (
                  <Badge tone="amber">Installation {r.installationStatus.toLowerCase()}</Badge>
                ) : null}
                <Button size="sm" variant="danger" disabled={busy} onClick={() => disconnect(r)}>
                  Disconnect
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <ConnectForm
          connectedIds={new Set(connected.data?.map((r) => r.githubRepositoryId) ?? [])}
          onConnected={connected.reload}
        />
      </div>
    </Card>
  );
}

function ConnectForm({
  connectedIds,
  onConnected,
}: {
  connectedIds: Set<number>;
  onConnected: () => void;
}) {
  const { project } = useProject();
  const installations = useApiQuery<GithubInstallationList>(
    `/github/installations?workspaceId=${project.workspaceId}`,
  );
  const active = installations.data?.installations.filter((i) => i.status === 'ACTIVE') ?? [];
  const [chosenInstallation, setChosenInstallation] = useState('');
  const installationId = chosenInstallation || active[0]?.id || '';
  const repos = useApiQuery<AvailableRepository[]>(
    installationId ? `/github/installations/${installationId}/repositories` : null,
  );
  const [repoId, setRepoId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const settingsLink = (
    <Link href={`/workspaces/${project.workspaceId}/settings`} className="underline">
      workspace settings
    </Link>
  );

  if (installations.error) return <Alert>{installations.error.message}</Alert>;
  if (!installations.data) return null;
  if (active.length === 0) {
    return (
      <Alert tone="info">
        To connect a repository, first install the GitHub App from the {settingsLink}.
      </Alert>
    );
  }

  const options = repos.data?.filter((r) => !connectedIds.has(r.githubRepositoryId)) ?? [];

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!repoId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.id}/repositories`, {
        body: { installationId, githubRepositoryId: Number(repoId) },
      });
      setRepoId('');
      onConnected();
      repos.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect the repository.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={connect} className="space-y-3 border-t border-neutral-100 pt-4">
      <h3 className="text-sm font-medium">Connect a repository</h3>
      {error ? <Alert>{error}</Alert> : null}
      {repos.error ? <Alert>{repos.error.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {active.length > 1 ? (
          <Select
            label="GitHub account"
            name="installation"
            value={installationId}
            onChange={(e) => {
              setChosenInstallation(e.target.value);
              setRepoId('');
            }}
          >
            {active.map((i) => (
              <option key={i.id} value={i.id}>
                {i.accountLogin}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          label="Repository"
          name="repository"
          value={repoId}
          disabled={repos.loading}
          onChange={(e) => setRepoId(e.target.value)}
        >
          <option value="">
            {repos.loading
              ? 'Loading repositories…'
              : options.length
                ? 'Choose a repository'
                : 'No more repositories available'}
          </option>
          {options.map((r) => (
            <option key={r.githubRepositoryId} value={r.githubRepositoryId}>
              {r.fullName}
              {r.connectedProjectIds.length ? ' (used by another project)' : ''}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-xs text-neutral-500">
        Only repositories the GitHub App was given access to are listed. Change that on GitHub, then
        reload this page.
      </p>
      <Button type="submit" variant="primary" disabled={busy || !repoId}>
        {busy ? 'Connecting…' : 'Connect repository'}
      </Button>
    </form>
  );
}

'use client';

import type {
  AvailableRepository,
  ConnectedRepository,
  GithubInstallationList,
} from '@devtrack/types';
import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Button, Card, EmptyState, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from '../projects/project-context';

/** Project Settings → Repositories (workspace admins). */
export function ProjectRepositories() {
  const { project } = useProject();
  const connected = useApiQuery<ConnectedRepository[]>(`/projects/${project.id}/repositories`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);

  /** Imports existing pull requests from GitHub (e.g. ones merged before connecting). */
  async function sync(repo: ConnectedRepository) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { imported } = await api<{ imported: number }>(
        `/projects/${project.id}/repositories/${repo.id}/sync`,
        { method: 'POST' },
      );
      setNotice(
        imported === 0
          ? `${repo.fullName} has no pull requests on GitHub yet.`
          : `Synced ${imported} pull request${imported === 1 ? '' : 's'} from ${repo.fullName}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sync pull requests.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(repo: ConnectedRepository) {
    setBusy(true);
    setError(null);
    setNotice(null);
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
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {connected.error ? <Alert tone="error">{connected.error.message}</Alert> : null}
        {connected.data?.length === 0 ? (
          <EmptyState
            title="No repositories connected"
            description="Connect a repository from your GitHub App installation below."
          />
        ) : null}
        {connected.data && connected.data.length > 0 ? (
          <ul className="divide-y divide-border/60">
            {connected.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-xs font-semibold text-graphite hover:text-accent hover:underline truncate block"
                  >
                    {r.fullName}
                  </a>
                  <p className="mt-0.5 text-xs text-mineral">
                    {r.visibility} · default branch {r.defaultBranch}
                    {r.connectedBy ? ` · connected by @${r.connectedBy.username}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.installationStatus !== 'ACTIVE' ? (
                    <Badge tone="amber">Installation {r.installationStatus.toLowerCase()}</Badge>
                  ) : null}
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={busy || r.installationStatus !== 'ACTIVE'}
                    onClick={() => sync(r)}
                    title="Import this repository's recent pull requests from GitHub"
                  >
                    Sync PRs
                  </Button>
                  <Button size="xs" variant="danger" disabled={busy} onClick={() => disconnect(r)}>
                    Disconnect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
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
    <Link
      href={`/workspaces/${project.workspaceId}/settings`}
      className="font-semibold underline text-accent"
    >
      workspace settings
    </Link>
  );

  if (installations.error) return <Alert tone="error">{installations.error.message}</Alert>;
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
    <form onSubmit={connect} className="space-y-3.5 border-t border-border/70 pt-4">
      <h3 className="text-xs font-semibold text-graphite uppercase tracking-wider">
        Connect a repository
      </h3>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {repos.error ? <Alert tone="error">{repos.error.message}</Alert> : null}
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
      <p className="text-xs text-mineral-muted">
        Only repositories the GitHub App was granted access to are listed. Update repository
        permissions on GitHub, then refresh this page.
      </p>
      <div className="pt-1">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !repoId}>
          {busy ? 'Connecting…' : 'Connect repository'}
        </Button>
      </div>
    </form>
  );
}

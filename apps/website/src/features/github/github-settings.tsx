'use client';

import type { GithubInstallation, GithubInstallationList } from '@devtrack/types';
import { useSearchParams } from 'next/navigation';
import { Alert, Badge, SettingsSection } from '@/components/ui';
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
  // For an App already installed on your GitHub account: GitHub then skips the install redirect.
  const connectHref = `/api/v1/github/connect?workspaceId=${encodeURIComponent(workspace.id)}`;
  const picks = params
    .getAll('pick')
    .map((p) => {
      const [id, ...login] = p.split(':');
      return id && /^\d+$/.test(id) ? { id, login: login.join(':') } : null;
    })
    .filter((p): p is { id: string; login: string } => p !== null);

  return (
    <SettingsSection
      id="github"
      title="GitHub"
      description="Install the DevTrack GitHub App on an account or organization, then connect its repositories to projects from each project's settings. Signing in with GitHub does not grant repository access."
      actions={
        query.data?.appConfigured ? (
          <div className="flex flex-wrap justify-end gap-2">
            <a
              href={connectHref}
              className="inline-flex items-center rounded-control border border-line px-3.5 py-2 text-sm font-medium whitespace-nowrap text-fg hover:bg-surface-muted"
            >
              Connect existing
            </a>
            <a
              href={installHref}
              className="inline-flex items-center rounded-control bg-fg px-3.5 py-2 text-sm font-medium whitespace-nowrap text-fg-on-inverse hover:bg-fg-secondary"
            >
              Install GitHub App
            </a>
          </div>
        ) : null
      }
    >
      <div className="space-y-3">
        {outcome === 'installed' ? (
          <Alert tone="success">
            GitHub App installed. You can now connect repositories to projects.
          </Alert>
        ) : null}
        {outcome === 'requested' ? (
          <Alert tone="info">
            Installation requested. An owner of the GitHub organization must approve it; then start
            the installation here again.
          </Alert>
        ) : null}
        {outcome === 'choose' && picks.length > 0 ? (
          <Alert tone="info">
            <p>Several GitHub installations are available. Choose the one to connect:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {picks.map((p) => (
                <li key={p.id}>
                  <a
                    href={`${connectHref}&installationId=${p.id}`}
                    className="inline-flex items-center rounded-control border border-line px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
                  >
                    {p.login || p.id}
                  </a>
                </li>
              ))}
            </ul>
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
          <p className="text-sm text-fg-subtle">No GitHub installations yet.</p>
        ) : null}
        <ul className="divide-y divide-line-subtle">
          {query.data?.installations.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.accountLogin}</p>
                <p className="text-xs text-fg-subtle">
                  {i.accountType} · installed{' '}
                  {new Date(i.installedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  {i.installedBy ? ` by @${i.installedBy.username}` : ''}
                </p>
              </div>
              <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}

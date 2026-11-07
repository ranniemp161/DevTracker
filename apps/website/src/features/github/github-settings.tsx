'use client';

import type { GithubInstallation, GithubInstallationList } from '@devtrack/types';
import { useSearchParams } from 'next/navigation';
import { Alert, Badge, Card, EmptyState } from '@/components/ui';
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
    <Card
      title="GitHub"
      description="Install the DevTrack GitHub App on an account or organization, then connect its repositories to projects from each project's settings. Signing in with GitHub does not grant repository access."
      actions={
        query.data?.appConfigured ? (
          <a
            href={installHref}
            className="inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold whitespace-nowrap text-white shadow-xs hover:bg-accent-hover transition-colors"
          >
            Install GitHub App
          </a>
        ) : null
      }
    >
      <div className="space-y-4">
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
        {errorCode ? <Alert tone="error">{githubErrorMessage(errorCode)}</Alert> : null}
        {query.error ? <Alert tone="error">{query.error.message}</Alert> : null}
        {query.data && !query.data.appConfigured ? (
          <Alert tone="info">
            The GitHub App is not configured on this server yet. Ask whoever runs DevTrack to set
            the GITHUB_APP_* variables.
          </Alert>
        ) : null}
        {query.data?.installations.length === 0 && query.data.appConfigured ? (
          <EmptyState
            title="No GitHub installations"
            description="Install the GitHub App to sync pull requests, commits, and releases with projects."
          />
        ) : null}
        <ul className="divide-y divide-border/60">
          {query.data?.installations.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-graphite">{i.accountLogin}</p>
                <p className="text-xs text-mineral">
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
    </Card>
  );
}

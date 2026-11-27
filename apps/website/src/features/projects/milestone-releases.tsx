'use client';

import type { GithubRelease, Milestone } from '@devtrack/types';
import { useState } from 'react';
import { TagIcon, XIcon } from '@/components/icons';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate } from './labels';
import { useProject } from './project-context';

/**
 * GitHub releases that deliver a milestone (decision record 0026). Display only: linking never
 * changes the stage. Leads and admins link releases of the project's connected repositories.
 */
export function MilestoneReleases({
  milestone: m,
  canManage,
  onChanged,
}: {
  milestone: Milestone;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { project } = useProject();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = useApiQuery<GithubRelease[]>(
    picking ? `/projects/${project.id}/releases` : null,
  );
  const linkedIds = new Set(m.releases.map((r) => r.id));
  const choices = (available.data ?? []).filter((r) => !linkedIds.has(r.id));

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPicking(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (m.releases.length === 0 && !canManage) return null;

  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-label font-medium text-fg-secondary">Releases</h3>
      {m.releases.length === 0 ? (
        <p className="text-xs text-fg-muted">No releases linked yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {m.releases.map((r) => (
            <li
              key={r.id}
              className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-1 text-xs text-fg"
            >
              <TagIcon size={14} className="shrink-0 text-fg-subtle" />
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline"
              >
                {r.tagName}
              </a>
              <span className="text-fg-muted">
                · {r.repository} · {formatDate(r.publishedAt)}
                {r.prerelease ? ' · pre-release' : ''}
                {r.source === 'AUTO' ? ' · auto' : ''}
              </span>
              {canManage ? (
                <button
                  type="button"
                  aria-label={`Unlink ${r.tagName}`}
                  disabled={busy}
                  onClick={() =>
                    call(() => api(`/milestones/${m.id}/releases/${r.id}`, { method: 'DELETE' }))
                  }
                  className="rounded-control p-0.5 text-fg-subtle hover:bg-surface-muted hover:text-fg"
                >
                  <XIcon size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`link-release-${m.id}`}>
              Release to link to {m.name}
            </label>
            <select
              id={`link-release-${m.id}`}
              value=""
              disabled={busy || !available.data}
              onChange={(e) =>
                e.target.value &&
                call(() =>
                  api(`/milestones/${m.id}/releases`, { body: { releaseId: e.target.value } }),
                )
              }
              className="h-7.5 rounded-control border border-line-control bg-surface px-2 text-label text-fg focus-visible:border-primary"
            >
              <option value="" disabled>
                {!available.data
                  ? 'Loading releases…'
                  : choices.length === 0
                    ? 'No other releases from connected repositories'
                    : 'Choose a release'}
              </option>
              {choices.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.tagName} · {r.repository}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="text-label text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="text-label font-medium text-fg-secondary hover:text-fg hover:underline"
          >
            Link release
          </button>
        )
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

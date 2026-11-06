'use client';

import type {
  ConnectedRepository,
  LinkedPullRequest,
  PullRequest,
  PullRequestState,
  Task,
} from '@devtrack/types';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Select } from '@/components/ui';
import { api, apiPage, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from '../projects/project-context';

const STATE: Record<PullRequestState, { label: string; tone: 'green' | 'blue' | 'neutral' }> = {
  open: { label: 'Open', tone: 'green' },
  merged: { label: 'Merged', tone: 'blue' },
  closed: { label: 'Closed', tone: 'neutral' },
};

/**
 * Task → Pull requests (decision record 0006). Linking never changes the task's status: the
 * team moves tasks to Done themselves.
 */
export function TaskPullRequests({ task, onChange }: { task: Task; onChange?: () => void }) {
  const { readOnly } = useProject();
  const linked = useApiQuery<LinkedPullRequest[]>(`/tasks/${task.id}/pull-requests`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlink(pr: LinkedPullRequest) {
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}/pull-requests/${pr.id}`, { method: 'DELETE' });
      linked.reload();
      onChange?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not unlink the pull request.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Pull requests">
      <div className="space-y-3">
        {error ? <Alert>{error}</Alert> : null}
        {linked.error ? <Alert>{linked.error.message}</Alert> : null}
        {linked.data?.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No linked pull requests. Mention {task.key} in a branch name or PR title to link one
            automatically.
          </p>
        ) : null}
        <ul className="divide-y divide-neutral-100">
          {linked.data?.map((pr) => (
            <li key={pr.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  #{pr.number} {pr.title}
                </a>
                <p className="text-xs text-neutral-500">
                  {pr.repository.fullName} · {pr.headBranch}
                  {pr.link.source === 'AUTO'
                    ? ' · linked automatically'
                    : pr.link.linkedBy
                      ? ` · linked by @${pr.link.linkedBy.username}`
                      : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATE[pr.state].tone}>
                  {pr.isDraft && pr.state === 'open' ? 'Draft' : STATE[pr.state].label}
                </Badge>
                {readOnly ? null : (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => unlink(pr)}>
                    Unlink
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {readOnly ? null : (
          <LinkForm
            task={task}
            linkedIds={new Set(linked.data?.map((p) => p.id) ?? [])}
            onLinked={() => {
              linked.reload();
              onChange?.();
            }}
          />
        )}
      </div>
    </Card>
  );
}

function LinkForm({
  task,
  linkedIds,
  onLinked,
}: {
  task: Task;
  linkedIds: Set<string>;
  onLinked: () => void;
}) {
  const { project } = useProject();
  const repos = useApiQuery<ConnectedRepository[]>(`/projects/${project.id}/repositories`);
  const [open, setOpen] = useState(false);
  const [repoId, setRepoId] = useState('');
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [prId, setPrId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!repos.data || repos.data.length === 0) return null;
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Link a pull request
      </Button>
    );
  }

  async function chooseRepo(id: string) {
    setRepoId(id);
    setPrId('');
    setPrs(null);
    setError(null);
    if (!id) return;
    try {
      setPrs((await apiPage<PullRequest>(`/repositories/${id}/pull-requests?limit=100`)).items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load pull requests.');
    }
  }

  async function link(e: React.FormEvent) {
    e.preventDefault();
    if (!prId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/tasks/${task.id}/pull-requests`, { body: { pullRequestId: prId } });
      setPrId('');
      setOpen(false);
      onLinked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not link the pull request.');
    } finally {
      setBusy(false);
    }
  }

  const options = prs?.filter((p) => !linkedIds.has(p.id)) ?? [];

  return (
    <form onSubmit={link} className="space-y-3 border-t border-neutral-100 pt-3">
      {error ? <Alert>{error}</Alert> : null}
      <Select
        label="Repository"
        name="repository"
        value={repoId}
        onChange={(e) => void chooseRepo(e.target.value)}
      >
        <option value="">Choose a repository</option>
        {repos.data.map((r) => (
          <option key={r.id} value={r.id}>
            {r.fullName}
          </option>
        ))}
      </Select>
      {repoId ? (
        <Select
          label="Pull request"
          name="pullRequest"
          value={prId}
          disabled={prs === null}
          onChange={(e) => setPrId(e.target.value)}
        >
          <option value="">
            {prs === null
              ? 'Loading…'
              : options.length
                ? 'Choose a pull request'
                : 'No pull requests received yet'}
          </option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.number} {p.title} ({STATE[p.state].label.toLowerCase()})
            </option>
          ))}
        </Select>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !prId}>
          {busy ? 'Linking…' : 'Link'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

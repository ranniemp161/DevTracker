'use client';

import type {
  ConnectedRepository,
  LinkedPullRequest,
  PullRequest,
  PullRequestState,
  Task,
} from '@devtrack/types';
import { useState } from 'react';
import { Alert, Badge, Button, PanelSection, Select } from '@/components/ui';
import { api, apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { ChecksBadge } from './checks-badge';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from '../projects/project-context';
import { rowMenuTrigger } from '../projects/property-styles';
import { ChevronRightIcon, MoreIcon } from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';

const STATE: Record<PullRequestState, { label: string; tone: 'green' | 'blue' | 'neutral' }> = {
  open: { label: 'Open', tone: 'green' },
  merged: { label: 'Merged', tone: 'blue' },
  closed: { label: 'Closed', tone: 'neutral' },
};

/**
 * Task → Pull requests (decision record 0006). Linking never changes the task's status: the
 * team moves tasks to Done themselves.
 */
export function TaskPullRequests({
  task,
  branchTip,
  onChange,
}: {
  task: Task;
  /** Suggested branch name shown when nothing is linked yet. */
  branchTip?: string;
  onChange?: () => void;
}) {
  const { readOnly } = useProject();
  const linked = useApiQuery<LinkedPullRequest[]>(`/tasks/${task.id}/pull-requests`);
  // Live updates (M7): links made elsewhere (e.g. automatically) and PR state changes.
  useRealtimeRefresh(
    (e) =>
      e.type === 'github.pull_request.updated' ||
      (e.type === 'activity.created' &&
        e.payload.taskId === task.id &&
        String(e.payload.action).startsWith('pull_request.')),
    linked.reload,
  );
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

  const open = linked.data?.filter((pr) => pr.state === 'open') ?? [];
  const done = linked.data?.filter((pr) => pr.state !== 'open') ?? [];

  return (
    <PanelSection title="Pull requests">
      <div className="space-y-3">
        {error ? <Alert>{error}</Alert> : null}
        {linked.error ? <Alert>{linked.error.message}</Alert> : null}
        {linked.data?.length === 0 ? (
          <div className="space-y-2 text-label text-fg-muted">
            <p>
              No linked pull requests. Mention {task.key} in a branch name or PR title to link one
              automatically.
            </p>
            {branchTip ? (
              <code className="block overflow-x-auto rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-fg-secondary">
                git checkout -b {branchTip}
              </code>
            ) : null}
          </div>
        ) : null}
        {open.length ? (
          <ul className="divide-y divide-line-subtle">
            {open.map((pr) => (
              <PrRow key={pr.id} pr={pr} busy={busy} readOnly={readOnly} onUnlink={unlink} />
            ))}
          </ul>
        ) : null}
        {/* Merged and closed PRs are history: folded so open work stays on top. */}
        {done.length ? (
          <details className="group" open={open.length === 0 && done.length <= 2}>
            <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control text-label text-fg-muted hover:text-fg pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon size={14} className="transition-transform group-open:rotate-90" />
              {done.length} merged or closed
            </summary>
            <ul className="divide-y divide-line-subtle">
              {done.map((pr) => (
                <PrRow key={pr.id} pr={pr} busy={busy} readOnly={readOnly} onUnlink={unlink} />
              ))}
            </ul>
          </details>
        ) : null}
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
    </PanelSection>
  );
}

/** One linked PR: number and title, branch and link source, CI badge, ⋯ actions. */
function PrRow({
  pr,
  busy,
  readOnly,
  onUnlink,
}: {
  pr: LinkedPullRequest;
  busy: boolean;
  readOnly: boolean;
  onUnlink: (pr: LinkedPullRequest) => void;
}) {
  const source =
    pr.link.source === 'AUTO'
      ? 'linked automatically'
      : pr.link.linkedBy
        ? `linked by @${pr.link.linkedBy.username}`
        : '';
  return (
    <li className="group/row flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer noopener"
            title={`${pr.repository.fullName} #${pr.number}: ${pr.title}`}
            className="min-w-0 truncate text-sm font-medium hover:underline"
          >
            <span className="text-fg-muted">#{pr.number}</span> {pr.title}
          </a>
          <span className="shrink-0">
            <Badge tone={STATE[pr.state].tone}>
              {pr.isDraft && pr.state === 'open' ? 'Draft' : STATE[pr.state].label}
            </Badge>
          </span>
        </div>
        <p className="truncate font-mono text-xs text-fg-subtle" title={source}>
          {pr.headBranch}
        </p>
        {/* CI on the head commit (decision record 0015). */}
        {pr.checks && pr.state === 'open' ? (
          <p className="mt-1 text-xs">
            <ChecksBadge state={pr.checks} />
          </p>
        ) : null}
      </div>
      {readOnly ? null : (
        <Menu
          label={`Pull request #${pr.number} actions`}
          align="end"
          disabled={busy}
          triggerProps={{ 'aria-label': `Pull request #${pr.number} actions` }}
          triggerClassName={rowMenuTrigger}
          menuClassName="w-44"
          trigger={<MoreIcon size={16} />}
        >
          <MenuItem
            onSelect={() => onUnlink(pr)}
            className="text-danger! hover:text-danger! focus-visible:text-danger!"
          >
            Unlink from task
          </MenuItem>
        </Menu>
      )}
    </li>
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
        Link a PR manually
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
    <form onSubmit={link} className="space-y-3 border-t border-line-subtle pt-3">
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

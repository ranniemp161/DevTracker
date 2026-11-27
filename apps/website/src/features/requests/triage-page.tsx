'use client';

import type { Milestone, TaskRequest } from '@devtrack/types';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { HeaderActions } from '@/components/page-header';
import { useToast } from '@/components/toaster';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Skeleton,
  StatusPill,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate } from '../projects/labels';
import { useProject } from '../projects/project-context';
import { TaskLink } from '@/components/task-link';
import { AttachmentGrid } from '../projects/attachment-grid';
import { AcceptDialog, type AcceptChoice } from './accept-dialog';

type Tab = 'new' | 'accepted' | 'declined';
const TABS: { value: Tab; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

/** 0023 §4: form requests and team proposals share one list. */
type SourceTab = 'all' | 'form' | 'internal';
const SOURCES: { value: SourceTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'form', label: 'Form' },
  { value: 'internal', label: 'Team' },
];

/** Requests from the public form to accept or decline (0016); who triages follows 0023 §4. */
export function TriagePage() {
  const { project, readOnly, reload: reloadProject } = useProject();
  const [tab, setTab] = useState<Tab>('new');
  const [source, setSource] = useState<SourceTab>('all');
  const sourceQuery = source === 'all' ? '' : `&source=${source}`;
  const query = useApiQuery<TaskRequest[]>(
    readOnly || !project.viewerCanTriage
      ? null
      : `/projects/${project.id}/requests?status=${tab}${sourceQuery}`,
  );
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<TaskRequest | null>(null);
  const [declining, setDeclining] = useState<TaskRequest | null>(null);
  const [reason, setReason] = useState('');

  async function run(request: TaskRequest, work: () => Promise<string>) {
    setBusy(request.id);
    setError(null);
    try {
      toast.show(await work());
      query.reload();
      reloadProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the request.');
    } finally {
      setBusy(null);
    }
  }

  /** 0024 §3: into a milestone (created first when new) or unscheduled, with optional assignees. */
  function accept(request: TaskRequest, choice: AcceptChoice) {
    void run(request, async () => {
      let milestone: { id: string; name: string } | null;
      if (choice.milestone && 'newName' in choice.milestone) {
        const created = await api<{ milestone: Milestone }>(`/projects/${project.id}/milestones`, {
          body: { name: choice.milestone.newName },
        });
        milestone = { id: created.milestone.id, name: created.milestone.name };
      } else {
        milestone = choice.milestone;
      }
      await api(`/requests/${request.id}/accept`, {
        method: 'POST',
        body: {
          milestoneId: milestone?.id ?? null,
          ...(choice.assigneeIds.length > 0 ? { assigneeIds: choice.assigneeIds } : {}),
        },
      });
      const key = request.task?.key ?? 'the request';
      return milestone ? `Accepted ${key} into ${milestone.name}` : `Accepted ${key} (unscheduled)`;
    });
  }

  function decline(request: TaskRequest, why: string) {
    void run(request, async () => {
      await api(`/requests/${request.id}/decline`, {
        method: 'POST',
        body: why.trim() ? { reason: why.trim() } : undefined,
      });
      return `Declined ${request.task?.key ?? 'the request'}`;
    });
  }

  if (readOnly) return <Alert tone="info">Archived projects can't triage requests.</Alert>;
  // People who don't triage see their own proposals here (0023 §5).
  if (!project.viewerCanTriage) return <MyProposals />;

  return (
    <div className="space-y-5">
      <HeaderActions>
        <SegmentedControl label="From" value={source} onChange={setSource} options={SOURCES} />
        <SegmentedControl label="Show" value={tab} onChange={setTab} options={TABS} />
      </HeaderActions>
      {!project.intake?.enabled && project.viewerCanManage ? (
        <Alert tone="info">
          The request form is off.{' '}
          <Link
            href={`/projects/${project.id}/settings#request-form`}
            className="font-medium underline"
          >
            Turn it on in settings
          </Link>{' '}
          to share a link with clients.
        </Alert>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {query.error ? <ErrorState message={query.error.message} onRetry={query.reload} /> : null}
      {!query.data && !query.error ? (
        <div role="status" aria-label="Loading requests" className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : null}
      {query.data?.length === 0 ? (
        <EmptyState>
          {tab === 'new'
            ? 'Nothing to triage. New requests from your form and proposals from the team show up here.'
            : `No ${tab} requests yet.`}
        </EmptyState>
      ) : null}
      <ul className="space-y-3">
        {query.data?.map((r) => (
          <li key={r.id} className="space-y-3 rounded-card border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      r.kind === 'bug'
                        ? 'bg-status-blocked-bg text-status-blocked-fg'
                        : 'bg-status-todo-bg text-status-todo-fg'
                    }`}
                  >
                    {r.kind === 'bug' ? 'Bug' : 'Request'}
                  </span>
                  {r.task ? <span className="font-mono">{r.task.key}</span> : null}
                  <span>{formatDate(r.createdAt)}</span>
                </p>
                {r.task ? (
                  <TaskLink
                    href={`/projects/${project.id}/tasks/${r.task.id}`}
                    className="block text-md font-semibold text-fg hover:underline"
                  >
                    {r.task.title}
                  </TaskLink>
                ) : (
                  <p className="text-md font-semibold text-fg-muted">Task deleted</p>
                )}
              </div>
              {r.task && tab === 'accepted' ? <StatusPill status={r.task.status} /> : null}
            </div>
            <p className="flex items-center gap-2 text-label text-fg-secondary">
              {r.source === 'internal' ? (
                r.reporter ? (
                  <>
                    <Avatar name={r.reporter.username} url={r.reporter.avatarUrl} size="xs" />
                    Proposed by @{r.reporter.username}
                  </>
                ) : (
                  <span className="text-fg-muted">Proposed by a former member.</span>
                )
              ) : r.contactDeleted ? (
                <span className="text-fg-muted">Contact details deleted after 90 days.</span>
              ) : r.reporterName || r.reporterEmail ? (
                <>
                  From {r.reporterName ?? 'someone'}
                  {r.reporterEmail ? (
                    <>
                      {' · '}
                      <a
                        href={`mailto:${r.reporterEmail}`}
                        className="text-primary hover:underline"
                      >
                        {r.reporterEmail}
                      </a>
                    </>
                  ) : null}
                </>
              ) : (
                <span className="text-fg-muted">No contact details given.</span>
              )}
            </p>
            {r.task && r.attachments.length > 0 ? (
              <AttachmentGrid taskId={r.task.id} attachments={r.attachments} compact />
            ) : null}
            {r.triagedBy && r.triagedAt ? (
              <p className="text-xs text-fg-muted">
                {r.status === 'accepted' ? 'Accepted' : 'Declined'} by @{r.triagedBy.username} on{' '}
                {formatDate(r.triagedAt)}
              </p>
            ) : null}
            {r.declineReason ? (
              <p className="text-label text-fg-secondary">Reason: {r.declineReason}</p>
            ) : null}
            {r.status === 'new' ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === r.id}
                  disabled={busy !== null}
                  onClick={() => setAccepting(r)}
                >
                  Accept
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setDeclining(r)}
                >
                  Decline
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <AcceptDialog
        key={accepting?.id ?? 'none'}
        request={accepting}
        onAccept={(r, choice) => {
          setAccepting(null);
          accept(r, choice);
        }}
        onCancel={() => setAccepting(null)}
      />
      <ConfirmDialog
        open={declining !== null}
        title="Decline this request?"
        confirmLabel="Decline and delete task"
        onConfirm={() => {
          const r = declining;
          setDeclining(null);
          setReason('');
          if (r) decline(r, reason);
        }}
        onCancel={() => {
          setDeclining(null);
          setReason('');
        }}
      >
        <p>
          Its task {declining?.task?.key} will be deleted. The request stays in the Declined list.
        </p>
        {declining?.source === 'internal' ? (
          <label className="mt-3 block text-sm">
            <span className="mb-1.5 block font-medium text-fg-secondary">
              Reason for @{declining.reporter?.username ?? 'the proposer'} (optional)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-control border border-line-control bg-surface px-2.5 py-1.5 text-sm"
            />
          </label>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

const PROPOSAL_STATUS: Record<
  TaskRequest['status'],
  { label: string; tone: 'amber' | 'green' | 'red' }
> = {
  new: { label: 'Waiting for a lead', tone: 'amber' },
  accepted: { label: 'Accepted', tone: 'green' },
  declined: { label: 'Declined', tone: 'red' },
};

/** A member's own proposals and what became of them (decision record 0023 §5). */
function MyProposals() {
  const { project } = useProject();
  const query = useApiQuery<TaskRequest[]>(`/projects/${project.id}/proposals?mine=true`);

  return (
    <div className="space-y-5">
      <p className="text-label text-fg-muted">
        The project leads triage requests in this project. Here is what happened to the tasks you
        proposed.
      </p>
      {query.error ? <ErrorState message={query.error.message} onRetry={query.reload} /> : null}
      {!query.data && !query.error ? (
        <div role="status" aria-label="Loading your proposals" className="space-y-3">
          <Skeleton className="h-16" />
        </div>
      ) : null}
      {query.data?.length === 0 ? (
        <EmptyState>You haven&apos;t proposed anything yet.</EmptyState>
      ) : null}
      <ul className="space-y-3">
        {query.data?.map((r) => (
          <li key={r.id} className="space-y-2 rounded-card border border-line bg-surface p-4">
            <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Badge tone={PROPOSAL_STATUS[r.status].tone}>{PROPOSAL_STATUS[r.status].label}</Badge>
              <span>{r.kind === 'bug' ? 'Bug' : 'Request'}</span>
              <span>{formatDate(r.createdAt)}</span>
            </p>
            {r.task ? (
              <TaskLink
                href={`/projects/${project.id}/tasks/${r.task.id}`}
                className="block text-md font-semibold text-fg hover:underline"
              >
                {r.task.title}
              </TaskLink>
            ) : (
              <p className="text-md font-semibold text-fg-muted">Task deleted</p>
            )}
            {r.triagedBy && r.triagedAt ? (
              <p className="text-xs text-fg-muted">
                {r.status === 'accepted' ? 'Accepted' : 'Declined'} by @{r.triagedBy.username} on{' '}
                {formatDate(r.triagedAt)}
              </p>
            ) : null}
            {r.declineReason ? (
              <p className="text-label text-fg-secondary">Reason: {r.declineReason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

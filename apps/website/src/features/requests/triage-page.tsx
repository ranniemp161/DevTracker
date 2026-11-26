'use client';

import type { TaskRequest } from '@devtrack/types';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { HeaderActions } from '@/components/page-header';
import { useToast } from '@/components/toaster';
import {
  Alert,
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

type Tab = 'new' | 'accepted' | 'declined';
const TABS: { value: Tab; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
];

/** Requests from the public form, for task editors to accept or decline (decision record 0016). */
export function TriagePage() {
  const { project, readOnly, reload: reloadProject } = useProject();
  const [tab, setTab] = useState<Tab>('new');
  const query = useApiQuery<TaskRequest[]>(
    readOnly ? null : `/projects/${project.id}/requests?status=${tab}`,
  );
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState<TaskRequest | null>(null);

  async function triage(request: TaskRequest, action: 'accept' | 'decline') {
    setBusy(request.id);
    setError(null);
    try {
      await api(`/requests/${request.id}/${action}`, { method: 'POST' });
      toast.show(
        action === 'accept'
          ? `Accepted ${request.task?.key ?? 'the request'}`
          : `Declined ${request.task?.key ?? 'the request'}`,
      );
      query.reload();
      reloadProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the request.');
    } finally {
      setBusy(null);
    }
  }

  if (readOnly) return <Alert tone="info">Archived projects can't triage requests.</Alert>;

  return (
    <div className="space-y-5">
      <HeaderActions>
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
            ? 'Nothing to triage. New requests from your form will show up here.'
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
            <p className="text-label text-fg-secondary">
              {r.contactDeleted ? (
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
            {r.triagedBy && r.triagedAt ? (
              <p className="text-xs text-fg-muted">
                {r.status === 'accepted' ? 'Accepted' : 'Declined'} by @{r.triagedBy.username} on{' '}
                {formatDate(r.triagedAt)}
              </p>
            ) : null}
            {r.status === 'new' ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === r.id}
                  disabled={busy !== null}
                  onClick={() => triage(r, 'accept')}
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
      <ConfirmDialog
        open={declining !== null}
        title="Decline this request?"
        confirmLabel="Decline and delete task"
        onConfirm={() => {
          const r = declining;
          setDeclining(null);
          if (r) void triage(r, 'decline');
        }}
        onCancel={() => setDeclining(null)}
      >
        Its task {declining?.task?.key} will be deleted. The request stays in the Declined list.
      </ConfirmDialog>
    </div>
  );
}

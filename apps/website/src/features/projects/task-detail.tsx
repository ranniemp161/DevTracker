'use client';

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@devtrack/types';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Avatar, Button, Card, Field, Select, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useSession } from '../session/session-context';
import { formatDate, PRIORITY_LABEL, TASK_STATUS_LABEL } from './labels';
import { ActivityFeed } from '../collaboration/activity-feed';
import { CommentThread } from '../collaboration/comment-thread';
import { TaskPullRequests } from '../github/task-pull-requests';
import { useProject } from './project-context';
import { TaskLabels } from './task-labels';

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const query = useApiQuery<{ task: Task }>(`/tasks/${taskId}`);
  // Live updates (M7): refetch when this task changes elsewhere.
  useRealtimeRefresh((e) => e.type.startsWith('task.') && e.entity.id === taskId, query.reload);
  const { project } = useProject();
  // Bumped after comments/edits so the History list re-fetches.
  const [history, setHistory] = useState(0);
  const bumpHistory = () => setHistory((h) => h + 1);

  if (query.error) {
    return (
      <div className="space-y-4 max-w-xl mx-auto py-8">
        <Alert>
          {query.error.status === 404
            ? 'This task does not exist or was deleted.'
            : query.error.message}
        </Alert>
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
        >
          ← Back to board
        </Link>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Skeleton className="h-6 w-32 rounded" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  const task = query.data.task;

  return (
    <TaskEditor
      key={task.updatedAt}
      task={task}
      history={history}
      bumpHistory={bumpHistory}
      onSaved={() => {
        query.reload();
        bumpHistory();
      }}
    />
  );
}

function TaskEditor({
  task,
  history,
  bumpHistory,
  onSaved,
}: {
  task: Task;
  history: number;
  bumpHistory: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { user } = useSession();
  const { project, members, readOnly } = useProject();
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canDelete = !readOnly && (task.reporter?.id === user.id || project.viewerCanManage);
  const dirty =
    form.title !== task.title ||
    form.description !== (task.description ?? '') ||
    form.status !== task.status ||
    form.priority !== task.priority ||
    form.dueDate !== (task.dueDate ?? '');

  async function call(fn: () => Promise<unknown>, after: () => void = onSaved) {
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      await fn();
      setSavedNotice(true);
      after();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Something went wrong.',
      );
      setSaving(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (form.title !== task.title) body.title = form.title;
    if (form.description !== (task.description ?? '')) body.description = form.description;
    if (form.status !== task.status) body.status = form.status;
    if (form.priority !== task.priority) body.priority = form.priority;
    if (form.dueDate !== (task.dueDate ?? '')) body.dueDate = form.dueDate || null;
    void call(() => api(`/tasks/${task.id}`, { method: 'PATCH', body }));
  }

  const unassigned = members.filter((m) => !task.assignees.some((a) => a.id === m.user.id));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
      {/* Main column: Title, Description, Actions, Discussion, History */}
      <div className="space-y-6 min-w-0">
        <form
          onSubmit={save}
          className="space-y-5 rounded-xl border border-border bg-surface p-5 shadow-xs"
        >
          {/* Header navigation & Discuss in Chat action */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/70">
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-mineral hover:text-graphite transition-colors"
            >
              <svg aria-hidden="true" className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                  clipRule="evenodd"
                />
              </svg>
              Board
            </Link>

            <Link
              href={`/projects/${project.id}/chat?task=${task.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-subtle/50 px-3 py-1.5 text-xs font-semibold text-graphite shadow-xs hover:border-accent hover:bg-accent-tint/40 hover:text-accent-text transition-colors"
            >
              <svg
                aria-hidden="true"
                className="size-3.5 text-accent"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 2c-4.418 0-8 3.134-8 7 0 1.76.74 3.37 1.97 4.6-.26.96-.82 2.15-1.74 2.89a.5.5 0 00.32.86c2.14.07 3.81-.67 4.88-1.42.82.26 1.68.4 2.57.4 4.418 0 8-3.134 8-7s-3.582-7-8-7z"
                  clipRule="evenodd"
                />
              </svg>
              Discuss in chat
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold tracking-wider text-accent bg-accent-tint/60 px-2 py-0.5 rounded-md border border-accent/20">
              {task.key}
            </span>
          </div>

          {error ? <Alert tone="error">{error}</Alert> : null}
          {savedNotice && !error ? <Alert tone="success">Changes saved.</Alert> : null}

          <Field
            label="Title"
            name="title"
            value={form.title}
            disabled={readOnly}
            maxLength={200}
            onChange={(e) => {
              setSavedNotice(false);
              setForm((f) => ({ ...f, title: e.target.value }));
            }}
          />

          <div className="space-y-1.5">
            <label htmlFor="field-description" className="block text-xs font-medium text-mineral">
              Description
            </label>
            <textarea
              id="field-description"
              rows={6}
              value={form.description}
              disabled={readOnly}
              placeholder="Add details, acceptance criteria, or technical notes…"
              onChange={(e) => {
                setSavedNotice(false);
                setForm((f) => ({ ...f, description: e.target.value }));
              }}
              className="block w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-graphite shadow-xs outline-none placeholder:text-mineral-muted focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </div>

          {/* Properties for mobile view (hidden on desktop where sidebar handles them) */}
          <div className="grid gap-3 sm:grid-cols-3 lg:hidden pt-2 border-t border-border/70">
            <Select
              label="Status"
              name="status"
              value={form.status}
              disabled={readOnly}
              onChange={(e) => {
                setSavedNotice(false);
                setForm((f) => ({ ...f, status: e.target.value as TaskStatus }));
              }}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>

            <Select
              label="Priority"
              name="priority"
              value={form.priority}
              disabled={readOnly}
              onChange={(e) => {
                setSavedNotice(false);
                setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }));
              }}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>

            <Field
              label="Due date"
              name="dueDate"
              type="date"
              value={form.dueDate}
              disabled={readOnly}
              onChange={(e) => {
                setSavedNotice(false);
                setForm((f) => ({ ...f, dueDate: e.target.value }));
              }}
            />
          </div>

          {readOnly ? null : (
            <div className="flex items-center gap-3 pt-3 border-t border-border/70">
              <Button type="submit" variant="primary" disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {canDelete ? (
                confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        call(
                          () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
                          () => router.push(`/projects/${project.id}`),
                        )
                      }
                    >
                      Confirm delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                    Delete task
                  </Button>
                )
              ) : null}
            </div>
          )}
        </form>

        {/* Discussion Section */}
        <CommentThread task={task} onActivity={bumpHistory} />

        {/* Pull Requests Section on mobile/tablet */}
        <div className="lg:hidden space-y-4">
          <TaskPullRequests task={task} onChange={bumpHistory} />
        </div>

        {/* History Section */}
        <Card title="History">
          <ActivityFeed
            projectId={project.id}
            taskId={task.id}
            limit={15}
            refreshKey={`${task.updatedAt}:${history}`}
          />
        </Card>
      </div>

      {/* Properties Sidebar (Desktop) */}
      <aside className="space-y-4 w-full">
        {/* Desktop Task Properties Card */}
        <Card title="Properties" className="hidden lg:block">
          <div className="space-y-3">
            <Select
              label="Status"
              name="status"
              value={form.status}
              disabled={readOnly}
              onChange={(e) => {
                const newStatus = e.target.value as TaskStatus;
                setForm((f) => ({ ...f, status: newStatus }));
                // Auto-save property changes on select for convenience if preferred, or keep dirty state
              }}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>

            <Select
              label="Priority"
              name="priority"
              value={form.priority}
              disabled={readOnly}
              onChange={(e) => {
                const newPriority = e.target.value as TaskPriority;
                setForm((f) => ({ ...f, priority: newPriority }));
              }}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>

            <Field
              label="Due date"
              name="dueDate"
              type="date"
              value={form.dueDate}
              disabled={readOnly}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />

            {dirty ? (
              <p className="text-[11px] text-amber-700 font-medium">
                Unsaved changes. Click &ldquo;Save changes&rdquo; above.
              </p>
            ) : null}
          </div>
        </Card>

        {/* Labels Card */}
        <TaskLabels task={task} onChanged={onSaved} />

        {/* Assignees Card */}
        <Card title="Assignees">
          <ul className="space-y-2">
            {task.assignees.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs">
                <Avatar name={a.username} url={a.avatarUrl} size="xs" />
                <span className="flex-1 font-medium text-graphite">@{a.username}</span>
                {readOnly ? null : (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={saving}
                    aria-label={`Unassign @${a.username}`}
                    onClick={() =>
                      call(() => api(`/tasks/${task.id}/assignees/${a.id}`, { method: 'DELETE' }))
                    }
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
            {task.assignees.length === 0 ? (
              <li className="text-xs text-mineral-muted">Nobody assigned yet.</li>
            ) : null}
          </ul>

          {!readOnly && unassigned.length > 0 ? (
            <label className="mt-3 block text-xs">
              <span className="sr-only">Assign someone</span>
              <select
                value=""
                disabled={saving}
                onChange={(e) =>
                  e.target.value &&
                  call(() =>
                    api(`/tasks/${task.id}/assignees`, { body: { userIds: [e.target.value] } }),
                  )
                }
                className="w-full rounded-lg border border-border bg-subtle/50 px-2 py-1.5 text-xs text-graphite hover:bg-white focus:border-accent focus:outline-none cursor-pointer"
              >
                <option value="">+ Assign someone…</option>
                {unassigned.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    @{m.user.username}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Card>

        {/* Pull Requests (Desktop) */}
        <div className="hidden lg:block">
          <TaskPullRequests task={task} onChange={bumpHistory} />
        </div>

        {/* Task Metadata Card */}
        <Card title="Details">
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-mineral">Reporter</dt>
              <dd className="font-medium text-graphite">
                {task.reporter ? `@${task.reporter.username}` : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mineral">Created</dt>
              <dd className="font-medium text-graphite">{formatDate(task.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mineral">Updated</dt>
              <dd className="font-medium text-graphite">{formatDate(task.updatedAt)}</dd>
            </div>
            {task.completedAt ? (
              <div className="flex justify-between">
                <dt className="text-mineral">Completed</dt>
                <dd className="font-medium text-emerald-700">{formatDate(task.completedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </aside>
    </div>
  );
}

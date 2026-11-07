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
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, XIcon } from '@/components/icons';
import {
  Alert,
  Avatar,
  Button,
  ErrorState,
  IconButton,
  PanelSection,
  PriorityIcon,
  Skeleton,
  StatusDot,
} from '@/components/ui';
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

export function TaskDetail({
  taskId: propTaskId,
  onClose,
  isDrawer = false,
  onTaskUpdated,
}: {
  taskId?: string;
  onClose?: () => void;
  isDrawer?: boolean;
  onTaskUpdated?: (task: Task) => void;
} = {}) {
  const params = useParams<{ taskId?: string }>();
  const taskId = propTaskId ?? params.taskId;
  const query = useApiQuery<{ task: Task }>(taskId ? `/tasks/${taskId}` : null);
  // Live updates (M7): refetch when this task changes elsewhere.
  useRealtimeRefresh(
    (e) => Boolean(taskId) && e.type.startsWith('task.') && e.entity.id === taskId,
    query.reload,
  );
  const { project } = useProject();
  // Bumped after comments/edits so the History list re-fetches.
  const [history, setHistory] = useState(0);
  const bumpHistory = () => setHistory((h) => h + 1);
  // "Saved" confirmation after the Save bar succeeds. Lives here because the editor re-mounts.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!taskId) return null;

  if (query.error) {
    return (
      <div className={`space-y-3 ${isDrawer ? 'p-6' : ''}`}>
        {query.error.status === 404 ? (
          <Alert>This task does not exist or was deleted.</Alert>
        ) : (
          <ErrorState message={query.error.message} onRetry={query.reload} />
        )}
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : (
          <Link href={`/projects/${project.id}`} className="text-sm underline">
            Back to board
          </Link>
        )}
      </div>
    );
  }
  if (!query.data) return <TaskSkeleton isDrawer={isDrawer} />;
  const task = query.data.task;
  // Re-mount the editor when the task changes on the server so the form shows fresh values.
  return (
    <TaskEditor
      key={task.updatedAt}
      task={task}
      saved={saved}
      historyKey={`${task.updatedAt}:${history}`}
      onActivity={bumpHistory}
      onSaved={() => {
        query.reload();
        bumpHistory();
        if (query.data?.task) {
          onTaskUpdated?.(query.data.task);
        }
      }}
      onFieldsSaved={() => setSaved(true)}
      onClose={onClose}
      isDrawer={isDrawer}
    />
  );
}

function TaskSkeleton({ isDrawer = false }: { isDrawer?: boolean }) {
  return (
    <div role="status" aria-label="Loading task" className={`space-y-4 ${isDrawer ? 'p-6' : ''}`}>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40" />
      <Skeleton className="h-24" />
    </div>
  );
}

/** Ghost-style native control used for values in the properties panel. */
const valueControl =
  'h-8 w-full cursor-pointer appearance-none rounded-control bg-transparent pr-7 text-sm text-fg transition-colors hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent';

function PropertyRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="w-24 shrink-0 text-label text-fg-muted">
        {label}
      </label>
      <div className="relative min-w-0 flex-1">{children}</div>
    </div>
  );
}

function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

function TaskEditor({
  task,
  saved,
  historyKey,
  onActivity,
  onSaved,
  onFieldsSaved,
  onClose,
  isDrawer = false,
}: {
  task: Task;
  saved: boolean;
  historyKey: string;
  onActivity: () => void;
  onSaved: () => void;
  onFieldsSaved: () => void;
  onClose?: () => void;
  isDrawer?: boolean;
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

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
    try {
      await fn();
      after();
    } catch (err) {
      // Keep everything the person typed; they can fix it and save again.
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
    // Send only the fields that changed.
    const body: Record<string, unknown> = {};
    if (form.title !== task.title) body.title = form.title;
    if (form.description !== (task.description ?? '')) body.description = form.description;
    if (form.status !== task.status) body.status = form.status;
    if (form.priority !== task.priority) body.priority = form.priority;
    if (form.dueDate !== (task.dueDate ?? '')) body.dueDate = form.dueDate || null;
    void call(
      () => api(`/tasks/${task.id}`, { method: 'PATCH', body }),
      () => {
        onFieldsSaved();
        onSaved();
      },
    );
  }

  function discard() {
    setError(null);
    setForm({
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? '',
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link.');
    }
  }

  const unassigned = members.filter((m) => !task.assignees.some((a) => a.id === m.user.id));
  const base = `/projects/${project.id}`;

  return (
    <div className={isDrawer ? 'flex h-full flex-col bg-surface' : '-mx-4 -my-6 sm:-mx-7'}>
      <header
        className={`flex min-h-13 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 sm:px-7 ${
          isDrawer ? 'sticky top-0 z-20 bg-surface/95 backdrop-blur-xs' : ''
        }`}
      >
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-label text-fg-muted"
        >
          {isDrawer ? (
            <span
              aria-current="page"
              className="rounded-chip bg-surface-muted px-2.5 py-1 font-mono text-xs font-semibold text-fg"
            >
              {task.key}
            </span>
          ) : (
            <>
              <Link href={base} className="truncate hover:text-fg hover:underline">
                {project.name}
              </Link>
              <span aria-hidden="true">/</span>
              <Link href={base} className="hover:text-fg hover:underline">
                Board
              </Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="font-mono text-fg">
                {task.key}
              </span>
            </>
          )}
        </nav>
        <div className="flex items-center gap-1.5">
          <span role="status" className="text-label font-medium text-status-done-fg">
            {saved ? 'Saved' : copied ? 'Link copied' : ''}
          </span>
          <Link
            href={`${base}/chat?task=${task.id}`}
            className="inline-flex h-7.5 items-center rounded-control border border-line-control bg-surface px-2.5 text-label font-medium text-fg transition-colors hover:bg-surface-sunken"
          >
            Discuss in chat
          </Link>
          <IconButton aria-label="Copy link to task" onClick={copyLink}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </svg>
          </IconButton>
          {isDrawer ? (
            <>
              <IconButton
                aria-label="Open task in full page"
                onClick={() => router.push(`${base}/tasks/${task.id}`)}
              >
                <ExternalLinkIcon size={14} />
              </IconButton>
              {onClose ? (
                <IconButton aria-label="Close task details" onClick={onClose}>
                  <XIcon size={16} />
                </IconButton>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      <div className={isDrawer ? 'flex-1 overflow-y-auto' : ''}>
        <div className={`grid ${isDrawer ? 'grid-cols-1' : 'lg:grid-cols-task'}`}>
          <form
            id="task-form"
            onSubmit={save}
            className={`space-y-3 px-4 py-6 sm:px-7 ${
              isDrawer ? 'lg:px-8 lg:pt-7' : 'lg:col-start-1 lg:row-start-1 lg:px-12 lg:pt-9'
            }`}
          >
            {error ? <Alert>{error}</Alert> : null}
            <div>
              <label htmlFor="task-title" className="sr-only">
                Title
              </label>
              <input
                id="task-title"
                value={form.title}
                disabled={readOnly}
                maxLength={200}
                placeholder="Task title"
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="block w-full rounded-control border border-transparent bg-transparent px-2 py-1 -mx-2 text-title font-semibold tracking-tight text-fg placeholder:text-fg-subtle hover:border-line focus-visible:border-primary"
              />
            </div>
            <div>
              <label htmlFor="task-description" className="sr-only">
                Description
              </label>
              <textarea
                id="task-description"
                rows={isDrawer ? 6 : 8}
                value={form.description}
                disabled={readOnly}
                placeholder="Add a description…"
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="block w-full rounded-control border border-transparent bg-transparent px-2 py-1.5 -mx-2 text-sm leading-relaxed text-fg-secondary placeholder:text-fg-subtle hover:border-line focus-visible:border-primary"
              />
            </div>
          </form>

          <aside
            aria-label="Task properties"
            className={`space-y-6 border-t border-line bg-surface-sunken p-6 ${
              isDrawer
                ? ''
                : 'lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0 lg:border-l'
            }`}
          >
            <div className="space-y-1.5">
              <PropertyRow label="Status" htmlFor="task-status">
                <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2">
                  <StatusDot status={form.status} />
                </span>
                <select
                  id="task-status"
                  value={form.status}
                  disabled={readOnly}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
                  className={`${valueControl} pl-7`}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                {readOnly ? null : <SelectChevron />}
              </PropertyRow>
              <PropertyRow label="Priority" htmlFor="task-priority">
                <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2">
                  <PriorityIcon priority={form.priority} showLabel={false} />
                </span>
                <select
                  id="task-priority"
                  value={form.priority}
                  disabled={readOnly}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))
                  }
                  className={`${valueControl} pl-8`}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
                {readOnly ? null : <SelectChevron />}
              </PropertyRow>
              <PropertyRow label="Due date" htmlFor="task-due">
                <input
                  id="task-due"
                  type="date"
                  value={form.dueDate}
                  disabled={readOnly}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className={`${valueControl} px-2 ${form.dueDate ? '' : 'text-fg-subtle'}`}
                />
              </PropertyRow>
            </div>

            <PanelSection title="Assignees">
              <ul className="space-y-1.5">
                {task.assignees.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm">
                    <Avatar name={a.username} url={a.avatarUrl} seed={a.id} size="xs" />
                    <span className="min-w-0 flex-1 truncate">@{a.username}</span>
                    {readOnly ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        aria-label={`Unassign @${a.username}`}
                        onClick={() =>
                          call(() =>
                            api(`/tasks/${task.id}/assignees/${a.id}`, { method: 'DELETE' }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
                {task.assignees.length === 0 ? (
                  <li className="text-sm text-fg-subtle">Nobody yet.</li>
                ) : null}
              </ul>
              {!readOnly && unassigned.length > 0 ? (
                <label className="relative block">
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
                    className="h-8 w-full cursor-pointer appearance-none rounded-control border border-dashed border-line-control bg-transparent px-2.5 pr-7 text-label text-fg-muted hover:bg-surface-muted"
                  >
                    <option value="">Assign someone…</option>
                    {unassigned.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        @{m.user.username}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </label>
              ) : null}
            </PanelSection>

            <TaskLabels task={task} onChanged={onSaved} />

            <TaskPullRequests
              task={task}
              branchTip={`${task.key}-${slugify(task.title)}`}
              onChange={onActivity}
            />

            <dl className="space-y-2 border-t border-line pt-4 text-label">
              <DetailRow label="Reporter">
                {task.reporter ? `@${task.reporter.username}` : '—'}
              </DetailRow>
              <DetailRow label="Created">{formatDate(task.createdAt)}</DetailRow>
              <DetailRow label="Updated">{formatDate(task.updatedAt)}</DetailRow>
              {task.completedAt ? (
                <DetailRow label="Completed">{formatDate(task.completedAt)}</DetailRow>
              ) : null}
            </dl>

            {canDelete ? (
              confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-label text-danger">
                    Delete this task? This can&apos;t be undone.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        call(
                          () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
                          () => {
                            onClose?.();
                            router.push(base);
                          },
                        )
                      }
                    >
                      Confirm delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete task
                </Button>
              )
            ) : null}
          </aside>

          <div
            className={`space-y-8 px-4 pb-8 sm:px-7 ${
              isDrawer ? 'lg:px-8' : 'lg:col-start-1 lg:row-start-2 lg:px-12'
            }`}
          >
            <div className="space-y-8 border-t border-line pt-6">
              <CommentThread task={task} onActivity={onActivity} />
              <section aria-labelledby="history-heading" className="space-y-3">
                <h2 id="history-heading" className="text-md font-semibold">
                  History
                </h2>
                <ActivityFeed
                  projectId={project.id}
                  taskId={task.id}
                  limit={15}
                  refreshKey={historyKey}
                />
              </section>
            </div>
          </div>
        </div>
      </div>

      {readOnly || !(dirty || saving) ? null : (
        <div
          className={`sticky bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-xs ${
            isDrawer ? 'shadow-xl' : 'sm:px-7 lg:px-12'
          }`}
        >
          <p className="text-label text-fg-muted">Unsaved changes</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button
              type="submit"
              form="task-form"
              variant="primary"
              size="sm"
              icon={saving ? undefined : <CheckIcon size={14} />}
              loading={saving}
              disabled={!dirty}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectChevron() {
  return (
    <ChevronDownIcon
      size={14}
      className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-subtle"
    />
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-fg-secondary">{children}</dd>
    </div>
  );
}

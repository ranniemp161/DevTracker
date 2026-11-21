'use client';

import { TASK_PRIORITIES, TASK_STATUSES, type Milestone, type Task } from '@devtrack/types';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, PlusIcon } from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';
import { useToast } from '@/components/toaster';
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
import { TaskTimeline } from '../collaboration/task-timeline';
import { TaskPullRequests } from '../github/task-pull-requests';
import { useProject } from './project-context';
import { TaskLabels } from './task-labels';
import { TaskTime } from './task-time';
import { TaskTimeEntries } from './task-time-entries';
import { TaskAttachments } from './task-attachments';
import { useTaskTimer } from './task-timer';

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const query = useApiQuery<{ task: Task }>(`/tasks/${taskId}`);
  const { saved: savedTime } = useTaskTimer();
  const reloadTask = query.reload;
  useEffect(() => {
    if (savedTime?.taskId === taskId) reloadTask();
  }, [savedTime, taskId, reloadTask]);
  // Live updates (M7): refetch when this task changes elsewhere.
  useRealtimeRefresh((e) => e.type.startsWith('task.') && e.entity.id === taskId, query.reload);
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

  if (query.error) {
    return (
      <div className="space-y-3">
        {query.error.status === 404 ? (
          <Alert>This task does not exist or was deleted.</Alert>
        ) : (
          <ErrorState message={query.error.message} onRetry={query.reload} />
        )}
        <Link href={`/projects/${project.id}`} className="text-sm underline">
          Back to board
        </Link>
      </div>
    );
  }
  if (!query.data) return <TaskSkeleton />;
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
      }}
      onFieldsSaved={() => setSaved(true)}
    />
  );
}

function TaskSkeleton() {
  return (
    <div role="status" aria-label="Loading task" className="space-y-4">
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
      {htmlFor ? (
        <label htmlFor={htmlFor} className="w-24 shrink-0 text-label text-fg-muted">
          {label}
        </label>
      ) : (
        <span className="w-24 shrink-0 text-label text-fg-muted">{label}</span>
      )}
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
}: {
  task: Task;
  saved: boolean;
  historyKey: string;
  onActivity: () => void;
  onSaved: () => void;
  onFieldsSaved: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  const { project, members, readOnly } = useProject();
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate ?? '',
    milestoneId: task.milestoneId ?? '',
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
    form.dueDate !== (task.dueDate ?? '') ||
    form.milestoneId !== (task.milestoneId ?? '');
  const milestonesQuery = useApiQuery<Milestone[]>(`/projects/${project.id}/milestones`);
  const milestones = milestonesQuery.data ?? [];
  const milestoneName = milestones.find((m) => m.id === form.milestoneId)?.name;

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
    if (form.milestoneId !== (task.milestoneId ?? '')) body.milestoneId = form.milestoneId || null;
    let unchanged = false;
    void call(
      async () => {
        const { task: updated } = await api<{ task: Task }>(`/tasks/${task.id}`, {
          method: 'PATCH',
          body,
        });
        // The server trims text, so e.g. a whitespace-only description is not a change. Then
        // `updatedAt` stays the same, the editor is not re-mounted, and we must reset it here.
        unchanged = updated.updatedAt === task.updatedAt;
      },
      () => {
        if (unchanged) {
          discard();
          setSaving(false);
          return;
        }
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
      milestoneId: task.milestoneId ?? '',
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
    <div className="-mx-4 -my-6 sm:-mx-7 lg:-my-8">
      <header className="flex min-h-13 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 sm:px-7">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-1.5 text-label text-fg-muted"
        >
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
        </nav>
        <div className="flex items-center gap-2">
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
          {/* Last in the row so the empty live region never offsets the buttons. */}
          <span role="status" className="text-label font-medium text-status-done-fg">
            {saved ? 'Saved' : copied ? 'Link copied' : ''}
          </span>
        </div>
      </header>

      <div className="grid lg:grid-cols-task lg:grid-rows-[auto_1fr]">
        <form
          id="task-form"
          onSubmit={save}
          className="min-w-0 space-y-5 px-4 py-6 sm:px-7 lg:col-start-1 lg:row-start-1 lg:px-10 lg:pt-8"
        >
          {error ? <Alert>{error}</Alert> : null}
          <div className="space-y-3">
            <label htmlFor="task-title" className="sr-only">
              Title
            </label>
            {/* A one-line textarea that grows, so long titles wrap instead of being cut off. */}
            <div className="-mx-2">
              <textarea
                id="task-title"
                rows={1}
                value={form.title}
                disabled={readOnly}
                maxLength={200}
                placeholder="Task title"
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value.replace(/[\r\n]+/g, ' ') }))
                }
                onKeyDown={(e) => {
                  // Enter saves, like the single-line field it replaces (never mid-IME composition).
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                className="block w-full resize-none rounded-control border border-transparent bg-transparent px-2 py-1 text-title font-semibold tracking-tight text-fg field-sizing-content placeholder:text-fg-subtle hover:border-line focus-visible:border-primary"
              />
            </div>
            <Menu
              label="Status"
              disabled={readOnly}
              triggerProps={{ 'aria-label': `Status: ${TASK_STATUS_LABEL[form.status]}` }}
              triggerClassName="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-control bg-surface-sunken px-2.5 text-sm font-medium text-fg transition-colors hover:bg-surface-muted aria-expanded:bg-surface-muted disabled:cursor-default disabled:hover:bg-surface-sunken lg:min-h-9"
              menuClassName="w-48"
              trigger={
                <>
                  <StatusDot status={form.status} />
                  {TASK_STATUS_LABEL[form.status]}
                  {readOnly ? null : <ChevronDownIcon size={14} className="text-fg-subtle" />}
                </>
              }
            >
              {TASK_STATUSES.map((st) => (
                <MenuItem
                  key={st}
                  checked={form.status === st}
                  icon={<StatusDot status={st} />}
                  onSelect={() => setForm((f) => ({ ...f, status: st }))}
                >
                  {TASK_STATUS_LABEL[st]}
                </MenuItem>
              ))}
            </Menu>
          </div>
          <div className="space-y-2">
            <label htmlFor="task-description" className="block text-label font-semibold text-fg">
              Description
            </label>
            <textarea
              id="task-description"
              rows={4}
              value={form.description}
              disabled={readOnly}
              placeholder="Add a description"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="block min-h-24 w-full rounded-control border border-line bg-surface px-3 py-2 field-sizing-content text-base leading-relaxed text-fg-secondary placeholder:text-fg-subtle hover:border-line-control focus-visible:border-primary lg:text-sm"
            />
          </div>
        </form>

        <aside
          aria-label="Task properties"
          className="min-w-0 space-y-6 border-t border-line bg-surface-sunken p-4 sm:p-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0 lg:border-l"
        >
          <div className="rounded-panel border border-line bg-surface p-4">
            <TaskTimeEntries task={task} onChanged={onSaved} />
          </div>

          <PanelSection title="Properties">
            <PropertyRow label="Priority">
              <Menu
                label="Priority"
                disabled={readOnly}
                triggerProps={{ 'aria-label': `Priority: ${PRIORITY_LABEL[form.priority]}` }}
                triggerClassName={pickerTrigger}
                menuClassName="w-44"
                trigger={
                  <PickerValue readOnly={readOnly}>
                    <PriorityIcon priority={form.priority} />
                  </PickerValue>
                }
              >
                {TASK_PRIORITIES.map((pr) => (
                  <MenuItem
                    key={pr}
                    checked={form.priority === pr}
                    onSelect={() => setForm((f) => ({ ...f, priority: pr }))}
                  >
                    <PriorityIcon priority={pr} />
                  </MenuItem>
                ))}
              </Menu>
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
            <PropertyRow label="Milestone">
              <Menu
                label="Milestone"
                disabled={readOnly}
                triggerProps={{ 'aria-label': `Milestone: ${milestoneName ?? 'none'}` }}
                triggerClassName={pickerTrigger}
                menuClassName="w-60"
                trigger={
                  <PickerValue readOnly={readOnly} muted={!milestoneName}>
                    {milestoneName ?? 'None'}
                  </PickerValue>
                }
              >
                <MenuItem
                  checked={form.milestoneId === ''}
                  onSelect={() => setForm((f) => ({ ...f, milestoneId: '' }))}
                >
                  None
                </MenuItem>
                {milestones.map((m) => (
                  <MenuItem
                    key={m.id}
                    checked={form.milestoneId === m.id}
                    onSelect={() => setForm((f) => ({ ...f, milestoneId: m.id }))}
                  >
                    {m.name}
                    {m.status === 'COMPLETED' ? (
                      <span className="text-fg-subtle"> · completed</span>
                    ) : null}
                  </MenuItem>
                ))}
              </Menu>
            </PropertyRow>
          </PanelSection>

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
                        call(() => api(`/tasks/${task.id}/assignees/${a.id}`, { method: 'DELETE' }))
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
              <div className="mt-2">
                <Menu
                  label="Assign someone"
                  disabled={saving}
                  triggerClassName="inline-flex h-8 w-full items-center gap-1.5 rounded-control border border-dashed border-line-control px-2.5 text-label text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg aria-expanded:bg-surface-muted pointer-coarse:h-11"
                  menuClassName="w-60"
                  trigger={
                    <>
                      <PlusIcon size={14} />
                      Assign someone
                    </>
                  }
                >
                  {unassigned.map((m) => (
                    <MenuItem
                      key={m.user.id}
                      icon={
                        <Avatar
                          name={m.user.username}
                          url={m.user.avatarUrl}
                          seed={m.user.id}
                          size="xs"
                        />
                      }
                      onSelect={() =>
                        call(() =>
                          api(`/tasks/${task.id}/assignees`, { body: { userIds: [m.user.id] } }),
                        )
                      }
                    >
                      @{m.user.username}
                    </MenuItem>
                  ))}
                </Menu>
              </div>
            ) : null}
          </PanelSection>

          <TaskLabels task={task} onChanged={onSaved} />

          <TaskPullRequests
            task={task}
            branchTip={`${task.key}-${slugify(task.title)}`}
            onChange={onActivity}
          />

          <details className="group border-t border-line pt-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-control py-2 text-label font-semibold text-fg [&::-webkit-details-marker]:hidden">
              Task history details
              <ChevronDownIcon size={14} className="text-fg-muted group-open:rotate-180" />
            </summary>
            <div className="space-y-4 pt-2">
              <TaskTime taskId={task.id} status={task.status} />
              <dl className="space-y-2 text-label">
                <DetailRow label="Reporter">
                  {task.reporter ? `@${task.reporter.username}` : '—'}
                </DetailRow>
                <DetailRow label="Created">{formatDate(task.createdAt)}</DetailRow>
                <DetailRow label="Updated">{formatDate(task.updatedAt)}</DetailRow>
                {task.completedAt ? (
                  <DetailRow label="Completed">{formatDate(task.completedAt)}</DetailRow>
                ) : null}
              </dl>
            </div>
          </details>

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
                          toast.show(`Deleted ${task.key}`);
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

        <div className="min-w-0 px-4 pt-4 pb-8 sm:px-7 lg:col-start-1 lg:row-start-2 lg:px-10 lg:pt-0">
          <div className="space-y-8 border-t border-line pt-6">
            <TaskAttachments key={task.id} taskId={task.id} />
            <TaskTimeline task={task} refreshKey={historyKey} onActivity={onActivity} />
          </div>
        </div>
      </div>

      {readOnly || !(dirty || saving) ? null : (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:px-7 lg:px-10">
          <p className="text-label text-fg-muted">Unsaved changes</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button
              type="submit"
              form="task-form"
              variant="primary"
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

/** Ghost button showing a property's value and a chevron (SPEC §5 properties panel). */
const pickerTrigger =
  'flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-sm text-fg transition-colors hover:bg-surface-muted aria-expanded:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:min-h-11';

function PickerValue({
  readOnly,
  muted = false,
  children,
}: {
  readOnly: boolean;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span className={`min-w-0 flex-1 truncate ${muted ? 'text-fg-subtle' : ''}`}>{children}</span>
      {readOnly ? null : <ChevronDownIcon size={14} className="shrink-0 text-fg-subtle" />}
    </>
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

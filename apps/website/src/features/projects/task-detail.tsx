'use client';

import { TASK_PRIORITIES, TASK_STATUSES, type Milestone, type Task } from '@devtrack/types';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  ChevronRightIcon,
  FlagIcon,
  LinkIcon,
  MoreIcon,
  UserPlusIcon,
  XIcon,
} from '@/components/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Markdown } from '@/components/markdown';
import { Menu, MenuItem } from '@/components/menu';
import { useToast } from '@/components/toaster';
import {
  Alert,
  Avatar,
  Button,
  ErrorState,
  IconButton,
  PriorityIcon,
  SegmentedControl,
  Skeleton,
  StatusDot,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { clickFirst, useShortcuts } from '@/lib/shortcuts';
import { useApiQuery } from '@/lib/use-api-query';
import { useSession } from '../session/session-context';
import { formatDate, PRIORITY_LABEL, TASK_STATUS_LABEL } from './labels';
import { TaskTimeline } from '../collaboration/task-timeline';
import { TaskPullRequests } from '../github/task-pull-requests';
import { useProject } from './project-context';
import { TaskLabels } from './task-labels';
import { chipStatic, chipTrigger } from './property-styles';
import { TaskTime } from './task-time';
import { TaskTimeEntries } from './task-time-entries';
import { TaskAttachments } from './task-attachments';
import { TaskChecklist } from './task-checklist';
import { TaskRelations } from './task-relations';
import { TaskDonePromptBanner } from './task-done-prompt';
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
  // The rail sticks below the running-timer bar when there is one.
  const { timer } = useTaskTimer();
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
  const [copied, setCopied] = useState<string | null>(null);

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

  async function call(fn: () => Promise<unknown>, after?: () => void) {
    setSaving(true);
    setError(null);
    try {
      await fn();
      if (after) {
        after();
      } else {
        // Assignee changes can refresh the same editor without changing task.updatedAt.
        setSaving(false);
        onSaved();
      }
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

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(message);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  }

  const unassigned = members.filter((m) => !task.assignees.some((a) => a.id === m.user.id));
  const base = `/projects/${project.id}`;
  const neighbors = useTaskNeighbors(project.id, task.id);
  // Keyboard shortcuts (`?` lists them). Property keys open the same chips a click would.
  const chip = (selector: string) => () =>
    clickFirst(
      selector
        .split(',')
        .map((sel) => `[role="group"][aria-label="Properties"] ${sel.trim()}`)
        .join(', '),
    );
  useShortcuts([
    { key: 's', run: chip('button[aria-label^="Status:"]') },
    { key: 'p', run: chip('button[aria-label^="Priority:"]') },
    { key: 'a', run: chip('button[aria-label="Assign someone"]') },
    { key: 'l', run: chip('button[aria-label="Add a label"]') },
    { key: 'd', run: chip('button[aria-label="Set due date"], button[aria-label^="Due date:"]') },
    { key: 'm', run: chip('button[aria-label^="Milestone:"]') },
    {
      key: 'e',
      run: () =>
        clickFirst('[data-shortcut="edit-description"]') ||
        document.getElementById('task-description')?.focus(),
    },
    { key: 'c', run: () => document.getElementById('new-comment')?.focus() },
    { key: 'j', run: () => neighbors.next && router.push(neighbors.next) },
    { key: 'k', run: () => neighbors.prev && router.push(neighbors.prev) },
    { key: 'Escape', run: () => router.push(base) },
    {
      key: 's',
      mod: true,
      run: () => {
        if (dirty && !saving && !readOnly) {
          (document.getElementById('task-form') as HTMLFormElement | null)?.requestSubmit();
        }
      },
    },
  ]);

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
        <div className="flex items-center gap-1.5">
          {/* Before the buttons so they never shift; empty most of the time. */}
          <span role="status" className="text-label font-medium text-status-done-fg empty:hidden">
            {saved ? 'Saved' : (copied ?? '')}
          </span>
          {neighbors.total > 1 ? (
            <nav aria-label="Tasks in this project" className="flex items-center">
              <TaskStepLink href={neighbors.prev} label="Previous task (K)" flip />
              <span className="px-1 text-label text-fg-muted tabular-nums max-sm:sr-only">
                {neighbors.position} of {neighbors.total}
              </span>
              <TaskStepLink href={neighbors.next} label="Next task (J)" />
            </nav>
          ) : null}
          <Link
            href={`${base}/chat?task=${task.id}`}
            className="inline-flex h-7.5 items-center gap-1.5 rounded-control border border-line-control bg-surface px-2.5 text-label font-medium text-fg transition-colors hover:bg-surface-sunken pointer-coarse:h-11"
          >
            <ChatIcon size={14} />
            <span className="max-sm:sr-only">Discuss in chat</span>
          </Link>
          <IconButton
            aria-label="Copy link to task"
            onClick={() => copy(window.location.href, 'Link copied')}
          >
            <LinkIcon size={16} />
          </IconButton>
          <Menu
            label="Task actions"
            align="end"
            triggerProps={{ 'aria-label': 'Task actions' }}
            triggerClassName="touch-target inline-flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg aria-expanded:bg-surface-muted"
            menuClassName="w-44"
            trigger={<MoreIcon size={16} />}
          >
            <MenuItem onSelect={() => copy(task.key, 'Key copied')}>Copy key</MenuItem>
            {canDelete ? (
              <MenuItem
                onSelect={() => setConfirmDelete(true)}
                className="text-danger! hover:text-danger! focus-visible:text-danger!"
              >
                Delete task
              </MenuItem>
            ) : null}
          </Menu>
        </div>
      </header>

      <div className="grid lg:grid-cols-task lg:grid-rows-[auto_1fr]">
        <form
          id="task-form"
          onSubmit={save}
          className="min-w-0 px-4 pt-6 sm:px-7 lg:col-start-1 lg:row-start-1 lg:px-10 lg:pt-10"
        >
          <div className="mx-auto max-w-3xl space-y-3">
            {error ? <Alert>{error}</Alert> : null}
            <TaskDonePromptBanner taskId={task.id} taskKey={task.key} onChanged={onSaved} />
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
            {/* Property strip (DNA: the facts beside the title, always one glance away). */}
            <div
              role="group"
              aria-label="Properties"
              className="flex flex-wrap items-center gap-1.5"
            >
              <Menu
                label="Status"
                disabled={readOnly}
                triggerProps={{ 'aria-label': `Status: ${TASK_STATUS_LABEL[form.status]}` }}
                triggerClassName={chipTrigger}
                menuClassName="w-48"
                trigger={
                  <>
                    <StatusDot status={form.status} />
                    {TASK_STATUS_LABEL[form.status]}
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
              <Menu
                label="Priority"
                disabled={readOnly}
                triggerProps={{ 'aria-label': `Priority: ${PRIORITY_LABEL[form.priority]}` }}
                triggerClassName={chipTrigger}
                menuClassName="w-44"
                trigger={<PriorityIcon priority={form.priority} />}
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
              {task.assignees.map((a) => (
                <span key={a.id} className={`${chipStatic} pr-1 pl-1`}>
                  <Avatar name={a.username} url={a.avatarUrl} seed={a.id} size="xs" />
                  <span className="min-w-0 truncate">{a.username}</span>
                  {readOnly ? null : (
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={`Unassign @${a.username}`}
                      onClick={() =>
                        call(() => api(`/tasks/${task.id}/assignees/${a.id}`, { method: 'DELETE' }))
                      }
                      className="touch-target inline-flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-muted hover:text-fg"
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                </span>
              ))}
              {!readOnly && unassigned.length > 0 ? (
                <Menu
                  label="Assign someone"
                  disabled={saving}
                  triggerProps={{ 'aria-label': 'Assign someone' }}
                  triggerClassName={`${chipTrigger} ${task.assignees.length ? '' : 'text-fg-muted!'}`}
                  menuClassName="w-60"
                  trigger={
                    <>
                      <UserPlusIcon size={14} />
                      {task.assignees.length ? null : 'Assign'}
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
              ) : task.assignees.length === 0 ? (
                <span className={`${chipStatic} text-fg-muted`}>Unassigned</span>
              ) : null}
              <DueDatePicker
                value={form.dueDate}
                readOnly={readOnly}
                onChange={(dueDate) => setForm((f) => ({ ...f, dueDate }))}
              />
              <Menu
                label="Milestone"
                disabled={readOnly}
                triggerProps={{ 'aria-label': `Milestone: ${milestoneName ?? 'none'}` }}
                triggerClassName={`${chipTrigger} max-w-60 ${milestoneName ? '' : 'text-fg-muted!'}`}
                menuClassName="w-60"
                trigger={
                  <>
                    <FlagIcon size={14} className="shrink-0" />
                    <span className="min-w-0 truncate">{milestoneName ?? 'Milestone'}</span>
                  </>
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
              <TaskLabels task={task} onChanged={onSaved} />
              {/* Open blockers (0020): visible next to the status they hold up. */}
              {task.blockedByCount > 0 && task.status !== 'DONE' ? (
                <span className={`${chipStatic} border-danger-line! text-danger!`}>
                  <AlertIcon size={14} />
                  Blocked by {task.blockedByCount} {task.blockedByCount === 1 ? 'task' : 'tasks'}
                </span>
              ) : null}
            </div>
            <DescriptionField
              value={form.description}
              readOnly={readOnly}
              onChange={(description) => setForm((f) => ({ ...f, description }))}
            />
          </div>
        </form>

        {/* The rail's background spans the page; its content sticks and scrolls on its own. */}
        <div className="min-w-0 border-t border-line bg-surface-sunken max-lg:order-last lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t-0 lg:border-l">
          <aside
            aria-label="Task context"
            className={`divide-y divide-line px-4 sm:px-6 lg:task-rail [&>*]:py-5 ${timer ? 'lg:task-rail-below-timer' : ''}`}
          >
            <div>
              <TaskPullRequests
                task={task}
                branchTip={`${task.key}-${slugify(task.title)}`}
                onChange={onActivity}
              />
            </div>

            <div>
              <TaskTimeEntries task={task} onChanged={onSaved} />
            </div>

            {/* Reference facts: folded so the rail stays short. */}
            <details className="group">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-control text-label font-semibold text-fg pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                Details
                <ChevronRightIcon
                  size={14}
                  className="text-fg-muted transition-transform group-open:rotate-90"
                />
              </summary>
              <div className="space-y-5 pt-3">
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
                <TaskTime taskId={task.id} status={task.status} />
              </div>
            </details>
          </aside>
        </div>

        <div className="min-w-0 px-4 pt-8 pb-10 sm:px-7 lg:col-start-1 lg:row-start-2 lg:px-10">
          <div className="mx-auto max-w-3xl space-y-10">
            <TaskChecklist key={`checklist-${task.id}`} taskId={task.id} onChanged={onSaved} />
            <TaskRelations key={`relations-${task.id}`} taskId={task.id} onChanged={onSaved} />
            <TaskAttachments key={task.id} taskId={task.id} />
            <TaskTimeline task={task} refreshKey={historyKey} onActivity={onActivity} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${task.key}?`}
        confirmLabel="Delete task"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void call(
            () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
            () => {
              toast.show(`Deleted ${task.key}`);
              router.push(base);
            },
          );
        }}
      >
        Its comments, time entries and attachments go with it. This can&apos;t be undone.
      </ConfirmDialog>

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

/**
 * "Set due date" or the date, opening the browser's own date picker. The native input stays
 * in the page (invisible) so keyboards, screen readers and form semantics keep working.
 */
function DueDatePicker({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = input.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };
  return (
    <div className="relative inline-flex items-center">
      <input
        ref={input}
        id="task-due"
        type="date"
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute inset-0 opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        disabled={readOnly}
        onClick={openPicker}
        aria-label={value ? `Due date: ${formatDate(value)}. Change` : 'Set due date'}
        className={`${chipTrigger} ${value ? '' : 'text-fg-muted!'}`}
      >
        <CalendarIcon size={14} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate">
          {value ? formatDate(value) : 'Set due date'}
        </span>
      </button>
      {value && !readOnly ? (
        <IconButton size="sm" aria-label="Clear due date" onClick={() => onChange('')}>
          <XIcon size={12} />
        </IconButton>
      ) : null}
    </div>
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

/**
 * The task description (decision record 0019): Markdown, shown formatted. Editing has Write
 * and Preview tabs; the text still saves with the Save changes bar like every other field.
 */
function DescriptionField({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const empty = value.trim() === '';

  if (readOnly) {
    return empty ? (
      <p className="text-sm text-fg-subtle">No description.</p>
    ) : (
      <Markdown>{value}</Markdown>
    );
  }

  if (!editing && !empty) {
    return (
      <div className="group/desc relative -mx-2 rounded-control border border-transparent px-2 py-1.5 hover:border-line">
        {/* Clicking the text edits it, except on links, which open as usual. */}
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a')) return;
            setTab('write');
            setEditing(true);
          }}
          className="cursor-text"
        >
          <Markdown>{value}</Markdown>
        </div>
        <button
          type="button"
          data-shortcut="edit-description"
          aria-keyshortcuts="E"
          onClick={() => {
            setTab('write');
            setEditing(true);
          }}
          className="absolute top-1 right-1 rounded-control bg-surface px-2 py-1 text-label font-medium text-fg-muted opacity-0 transition-opacity group-hover/desc:opacity-100 hover:text-fg focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          Edit description
        </button>
      </div>
    );
  }

  return (
    <div className="-mx-2 rounded-control border border-line focus-within:border-primary">
      <div className="flex items-center justify-between gap-2 border-b border-line-subtle px-2 py-1.5">
        <SegmentedControl
          label="Description view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-fg-subtle sm:inline">Markdown supported</span>
          {!empty ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Done
            </Button>
          ) : null}
        </div>
      </div>
      {tab === 'write' ? (
        <>
          <label htmlFor="task-description" className="sr-only">
            Description
          </label>
          <textarea
            ref={textarea}
            id="task-description"
            rows={4}
            value={value}
            autoFocus={editing}
            placeholder="Add a description, acceptance criteria or technical notes… Markdown works: **bold**, - lists, `code`, [links](https://…)"
            onChange={(e) => onChange(e.target.value)}
            className="block min-h-28 w-full resize-none rounded-b-control bg-transparent px-3 py-2 field-sizing-content text-base leading-relaxed text-fg-secondary placeholder:text-fg-subtle focus-visible:shadow-none! lg:text-sm"
          />
        </>
      ) : (
        <div className="min-h-28 px-3 py-2">
          {empty ? (
            <p className="text-sm text-fg-subtle">Nothing to preview.</p>
          ) : (
            <Markdown>{value}</Markdown>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Previous and next task for J/K and the header arrows, in the List view's order (by status,
 * then newest). Uses the first 200 tasks, like the board.
 */
function useTaskNeighbors(projectId: string, taskId: string) {
  const query = useApiQuery<Task[] | { items?: Task[] }>(
    `/projects/${projectId}/tasks?sort=status&limit=200`,
  );
  const list = Array.isArray(query.data) ? query.data : (query.data?.items ?? []);
  const index = list.findIndex((t) => t.id === taskId);
  const href = (t: Task | undefined) => (t ? `/projects/${projectId}/tasks/${t.id}` : null);
  return {
    prev: index > 0 ? href(list[index - 1]) : null,
    next: index >= 0 ? href(list[index + 1]) : null,
    position: index + 1,
    total: index >= 0 ? list.length : 0,
  };
}

function TaskStepLink({
  href,
  label,
  flip = false,
}: {
  href: string | null;
  label: string;
  flip?: boolean;
}) {
  const icon = <ChevronRightIcon size={16} className={flip ? 'rotate-180' : ''} />;
  const cls =
    'touch-target inline-flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors';
  return href ? (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`${cls} hover:bg-surface-muted hover:text-fg`}
    >
      {icon}
    </Link>
  ) : (
    <span aria-hidden="true" className={`${cls} opacity-40`}>
      {icon}
    </span>
  );
}

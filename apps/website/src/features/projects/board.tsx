'use client';

import {
  TASK_STATUSES,
  type Milestone,
  type RequestKind,
  type Task,
  type TaskStatus,
} from '@devtrack/types';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type RefObject,
} from 'react';
import { AlertIcon, CalendarIcon, ChecklistIcon, PlusIcon } from '@/components/icons';
import { ChecksBadge } from '../github/checks-badge';
import { HeaderActions } from '@/components/page-header';
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
import { useApiQuery } from '@/lib/use-api-query';
import { useShortcuts } from '@/lib/shortcuts';
import { formatDate, MILESTONE_STAGE_LABEL, PRIORITY_RANK, TASK_STATUS_LABEL } from './labels';
import { LabelChip } from './label-chip';
import { useProject } from './project-context';
import { filterTask, TaskFilterBar, useTaskFilters } from './task-filters';
import { TaskStatusMenu } from './task-status-menu';
import { useProjectTasks } from './use-project-tasks';
import { TaskLink } from '@/components/task-link';

const byPriorityThenAge = (a: Task, b: Task) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);

/** Today as a local YYYY-MM-DD string, comparable with calendar-date strings. */
function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Kanban view: one column per status; dropping a card in a column changes its status (M3 rule 8). */
export function Board() {
  const { project, members, readOnly } = useProject();
  const { tasks, setTasks, error, reload } = useProjectTasks(project.id);
  const { filters } = useTaskFilters();
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [chosenColumn, setAddingIn] = useState<TaskStatus | null>(null);
  // 0024 §4: "New task" (button, N, ?new=1) lets the milestone choice set the status; a
  // column's own + button picks that column's status.
  const [viaButton, setViaButton] = useState(false);
  // "New task" from the sidebar opens the board with ?new=1: quick add in To do.
  const searchParams = useSearchParams();
  const router = useRouter();
  const wantsNew = searchParams.get('new') === '1' && !readOnly;
  // 0023 §3: with internal triage in effect, members propose, and proposals land in Backlog.
  const propose = project.viewerMustPropose;
  const newColumn: TaskStatus = propose ? 'BACKLOG' : 'TODO';
  const addingIn = chosenColumn ?? (wantsNew ? newColumn : null);
  const statusFromMilestone = chosenColumn === null ? wantsNew : viaButton;
  function stopAdding() {
    setAddingIn(null);
    setViaButton(false);
    if (wantsNew) {
      const rest = new URLSearchParams(searchParams.toString());
      rest.delete('new');
      router.replace(rest.size ? `?${rest}` : `/projects/${project.id}`, { scroll: false });
    }
  }
  const columnRefs = useRef(new Map<TaskStatus, HTMLElement>());
  const visibleColumn = useVisibleColumn(columnRefs, tasks !== null);

  /** Brings a column into view in the horizontally scrolling lanes (phones and tablets). */
  function showColumn(status: TaskStatus) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    columnRefs.current.get(status)?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'start',
    });
  }

  function startAdding(status: TaskStatus, fromButton = false) {
    setAddingIn(status);
    setViaButton(fromButton);
    showColumn(status);
  }

  // `N` new task in To do, `/` jumps to the task search (`?` lists all shortcuts).
  useShortcuts([
    { key: 'n', run: () => !readOnly && startAdding(newColumn, true) },
    {
      key: '/',
      run: () =>
        document.querySelector<HTMLInputElement>('input[placeholder="Search tasks"]')?.focus(),
    },
  ]);

  const toast = useToast();
  // Undo runs after later renders; it must see the board as it is then, not as it was.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  async function moveTask(taskId: string, status: TaskStatus, { isUndo = false } = {}) {
    const before = tasksRef.current;
    const task = before?.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    setDropError(null);
    setTasks((current) => current?.map((t) => (t.id === taskId ? { ...t, status } : t)) ?? null);
    try {
      const { task: updated } = await api<{ task: Task }>(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: { status },
      });
      setTasks((current) => current?.map((t) => (t.id === taskId ? updated : t)) ?? null);
      if (isUndo) {
        toast.show(`Moved ${task.key} back to ${TASK_STATUS_LABEL[status]}`);
      } else {
        toast.show(`Moved ${task.key} to ${TASK_STATUS_LABEL[status]}`, {
          label: 'Undo',
          onClick: () => undoMove(taskId, status, task.status),
        });
      }
    } catch (err) {
      setTasks(before); // roll back the optimistic move
      setDropError(err instanceof ApiError ? err.message : 'Could not move the task.');
    }
  }

  /** Moves a task back, unless someone changed it again after our move. */
  async function undoMove(taskId: string, movedTo: TaskStatus, previous: TaskStatus) {
    const current = tasksRef.current?.find((t) => t.id === taskId);
    if (!current) {
      toast.show('That task is no longer on the board.');
    } else if (current.status !== movedTo) {
      toast.show(`${current.key} changed again since, so it wasn't moved back.`);
    } else {
      await moveTask(taskId, previous, { isUndo: true });
    }
  }

  // Cards are memoized, so they get one stable callback that always runs the latest moveTask.
  const moveTaskRef = useRef(moveTask);
  useEffect(() => {
    moveTaskRef.current = moveTask;
  });
  const onMoveCard = useCallback((taskId: string, status: TaskStatus) => {
    void moveTaskRef.current(taskId, status);
  }, []);

  function onDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData('text/devtrack-task');
    if (taskId) void moveTask(taskId, status);
  }

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!tasks) return <BoardSkeleton />;

  const doneCount = tasks.filter((t) => t.status === 'DONE').length;

  return (
    <div className="space-y-4">
      <HeaderActions>
        <BoardProgress done={doneCount} total={tasks.length} />
        {readOnly ? null : (
          <Button
            variant="primary"
            icon={<PlusIcon size={15} />}
            onClick={() => startAdding(newColumn, true)}
          >
            {propose ? 'Propose task' : 'New task'}
          </Button>
        )}
      </HeaderActions>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3 lg:items-center lg:gap-3">
        <TaskFilterBar workspaceId={project.workspaceId} projectId={project.id} members={members} />
        <Button variant="ghost" size="sm" onClick={reload}>
          Refresh
        </Button>
      </div>
      {dropError ? <Alert>{dropError}</Alert> : null}
      {/* Under 1024px only one or two lanes fit, so offer a jump list with counts (one scrolling row). */}
      <nav
        aria-label="Board columns"
        className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:-mx-7 sm:px-7 lg:hidden"
      >
        <ul className="flex w-max gap-1.5 pb-1">
          {TASK_STATUSES.map((status) => {
            const count = tasks.filter(
              (t) => t.status === status && filterTask(t, filters, project.key),
            ).length;
            const current = visibleColumn === status;
            return (
              <li key={status}>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => showColumn(status)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-label font-medium transition-colors pointer-coarse:h-11 ${
                    current
                      ? 'border-fg bg-fg text-fg-on-inverse'
                      : 'border-line bg-surface text-fg-secondary hover:bg-surface-muted'
                  }`}
                >
                  <StatusDot status={status} />
                  {TASK_STATUS_LABEL[status]}
                  <span className={current ? 'text-fg-on-inverse' : 'text-fg-muted'}>{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="-mx-4 snap-x snap-proximity scroll-px-4 overflow-x-auto px-4 pb-2 sm:-mx-7 sm:scroll-px-7 sm:px-7 lg:snap-none">
        <div className="flex w-max gap-3.5">
          {TASK_STATUSES.map((status) => {
            const column = tasks
              .filter((t) => t.status === status && filterTask(t, filters, project.key))
              .sort(byPriorityThenAge);
            return (
              <section
                key={status}
                ref={(el) => {
                  if (el) columnRefs.current.set(status, el);
                  else columnRefs.current.delete(status);
                }}
                data-status={status}
                aria-label={TASK_STATUS_LABEL[status]}
                onDragOver={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                onDrop={(e) => onDrop(e, status)}
                className={`flex min-h-64 w-75 max-w-[calc(100dvw-3rem)] flex-none snap-start flex-col rounded-panel border p-2 transition-colors lg:w-68 ${
                  dragOver === status
                    ? 'border-primary bg-primary-soft'
                    : 'border-line bg-surface-sunken'
                }`}
              >
                <header className="flex h-8 items-center gap-2 px-1.5">
                  <StatusDot status={status} />
                  <h2 className="text-label font-semibold text-fg">{TASK_STATUS_LABEL[status]}</h2>
                  <span className="text-xs text-fg-muted">{column.length}</span>
                  {readOnly || (propose && status !== 'BACKLOG') ? null : (
                    <IconButton
                      size="sm"
                      aria-label={
                        propose ? 'Propose a task' : `Add task to ${TASK_STATUS_LABEL[status]}`
                      }
                      onClick={() => startAdding(status)}
                      className="ml-auto"
                    >
                      <PlusIcon size={14} />
                    </IconButton>
                  )}
                </header>
                <div className="mt-1 flex flex-1 flex-col gap-2">
                  {addingIn === status && !readOnly ? (
                    <ColumnQuickAdd
                      status={status}
                      statusFromMilestone={statusFromMilestone}
                      propose={propose}
                      onCancel={stopAdding}
                      onCreated={(t) => {
                        setTasks((c) => [t, ...(c ?? [])]);
                        stopAdding();
                      }}
                    />
                  ) : null}
                  {column.length === 0 && addingIn !== status ? (
                    <div className="flex h-22 items-center justify-center rounded-card border border-dashed border-line-dashed text-label text-fg-subtle">
                      No tasks
                    </div>
                  ) : null}
                  <ul className="space-y-2">
                    {column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        draggable={!readOnly}
                        onMove={onMoveCard}
                        readOnly={readOnly}
                      />
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * The lane most visible in the board's scroll area, for the column jump list.
 * Starts as the first column.
 */
function useVisibleColumn(
  columnRefs: RefObject<Map<TaskStatus, HTMLElement>>,
  ready: boolean,
): TaskStatus {
  const [visible, setVisible] = useState<TaskStatus>(TASK_STATUSES[0]);
  useEffect(() => {
    if (!ready) return;
    const ratios = new Map<TaskStatus, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(
            entry.target.getAttribute('data-status') as TaskStatus,
            entry.intersectionRatio,
          );
        }
        let best: TaskStatus | null = null;
        for (const status of TASK_STATUSES) {
          const ratio = ratios.get(status) ?? 0;
          if (ratio > 0 && ratio > (best ? (ratios.get(best) ?? 0) : 0)) best = status;
        }
        if (best) setVisible(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of columnRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [columnRefs, ready]);
  return visible;
}

/** "N of M done" with a small bar, computed from the loaded tasks (SPEC R3). */
function BoardProgress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2.5 text-label text-fg-muted">
      <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted">
        <span
          className="block h-full rounded-full bg-status-done"
          style={{ width: `${percent}%` }}
        />
      </span>
      {done} of {total} done
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div role="status" aria-label="Loading tasks" className="space-y-4">
      <Skeleton className="h-7.5 w-72" />
      <div className="flex gap-3.5 overflow-hidden">
        {TASK_STATUSES.map((s) => (
          <div
            key={s}
            className="w-68 flex-none space-y-2 rounded-panel border border-line bg-surface-sunken p-2"
          >
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-24 bg-surface" />
            <Skeleton className="h-24 bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Memoized: moving one card or dragging over a column doesn't re-render the others (#128). */
const TaskCard = memo(function TaskCard({
  task,
  draggable,
  onMove,
  readOnly,
}: {
  task: Task;
  draggable: boolean;
  onMove: (taskId: string, status: TaskStatus) => void;
  readOnly: boolean;
}) {
  const { project } = useProject();
  const blocked = task.blockedByCount > 0 && task.status !== 'DONE';
  const overdue =
    Boolean(task.dueDate) && task.status !== 'DONE' && task.dueDate!.slice(0, 10) < todayIso();
  const shownLabels = task.labels.slice(0, 2);
  const extraLabels = task.labels.length - shownLabels.length;
  const assignees = task.assignees.slice(0, 3);

  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/devtrack-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`card-offscreen-lazy relative flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-line-control ${
        task.status === 'DONE' ? 'opacity-75' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-fg-muted">{task.key}</span>
        <div className="relative z-10 flex items-center gap-1.5">
          {readOnly ? (
            <StatusDot status={task.status} />
          ) : (
            <TaskStatusMenu status={task.status} onSelect={(s) => onMove(task.id, s)} />
          )}
          {assignees.length > 0 ? (
            <div className="flex -space-x-1.5">
              {assignees.map((a) => (
                <span
                  key={a.id}
                  title={`@${a.username}`}
                  className="rounded-full ring-2 ring-surface"
                >
                  <Avatar name={a.username} url={a.avatarUrl} seed={a.id} size="xs" />
                </span>
              ))}
            </div>
          ) : (
            <span
              role="img"
              aria-label="Unassigned"
              className="inline-block size-5 rounded-full border border-dashed border-line-control"
            />
          )}
        </div>
      </div>
      {/* Stretched link: the whole card opens the task, the status menu sits above it. */}
      <TaskLink
        href={`/projects/${project.id}/tasks/${task.id}`}
        className="line-clamp-3 rounded-chip text-sm leading-snug font-medium text-fg after:absolute after:inset-0 after:rounded-card"
      >
        {task.title}
      </TaskLink>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <PriorityIcon priority={task.priority} />
        {shownLabels.map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
        {extraLabels > 0 ? <span className="text-xs text-fg-muted">+{extraLabels}</span> : null}
      </div>
      {task.dueDate || task.checks || task.checklist.total > 0 || blocked ? (
        <div className="flex items-center justify-between gap-2 border-t border-line-subtle pt-2 text-xs text-fg-muted">
          <span className="flex min-w-0 items-center gap-3">
            {task.dueDate ? (
              <span
                className={`inline-flex items-center gap-1.5 ${overdue ? 'font-medium text-danger' : ''}`}
              >
                <CalendarIcon size={14} />
                {overdue ? 'Overdue · ' : ''}
                {formatDate(task.dueDate)}
              </span>
            ) : null}
            {/* Open blockers (0020). */}
            {blocked ? (
              <span className="inline-flex items-center gap-1 font-medium text-danger">
                <AlertIcon size={14} />
                Blocked
                <span className="sr-only">
                  {' '}
                  by {task.blockedByCount} open {task.blockedByCount === 1 ? 'task' : 'tasks'}
                </span>
              </span>
            ) : null}
            {/* Checklist progress (0018). */}
            {task.checklist.total > 0 ? (
              <span
                className={`inline-flex items-center gap-1 tabular-nums ${task.checklist.done === task.checklist.total ? 'text-status-done-fg' : ''}`}
              >
                <ChecklistIcon size={14} />
                <span className="sr-only">Checklist</span>
                {task.checklist.done}/{task.checklist.total}
              </span>
            ) : null}
          </span>
          {/* CI on open linked PRs (0015). */}
          {task.checks ? <ChecksBadge state={task.checks} /> : null}
        </div>
      ) : null}
    </li>
  );
});

const PROPOSAL_KINDS: { value: RequestKind; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'request', label: 'Request' },
];

/**
 * Inline quick-add in a column; the task is created with that column's status. As a proposal
 * (0023 §3) it also takes a type and a description, and goes to Triage as a Backlog task.
 */
const UNSCHEDULED = 'unscheduled';

function ColumnQuickAdd({
  status,
  statusFromMilestone,
  propose,
  onCreated,
  onCancel,
}: {
  status: TaskStatus;
  /** Leave the status to the API: Backlog when unscheduled, To do in a milestone (0024 §4). */
  statusFromMilestone: boolean;
  propose: boolean;
  onCreated: (task: Task) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RequestKind>('bug');
  const [description, setDescription] = useState('');
  const { project } = useProject();
  // 0024 §4: with triage required, leads and admins triage as they create, so they choose a
  // milestone or Unscheduled. Members propose instead, and the triager chooses.
  const schedule = project.internalTriage && !propose;
  const milestonesQuery = useApiQuery<Milestone[]>(
    schedule ? `/projects/${project.id}/milestones` : null,
  );
  // Delivered milestones take no new tasks (0025 §2).
  const openMilestones = (milestonesQuery.data ?? []).filter((m) => m.status !== 'DELIVERED');
  const [milestone, setMilestone] = useState('');
  const draftKey = `devtrack_task_draft_${project.id}`;
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(draftKey) ?? '';
    }
    return '';
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The board scrolls the column into view itself; a focus scroll would cut that short.
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  function handleTitleChange(val: string) {
    setTitle(val);
    if (typeof window !== 'undefined') {
      if (val) {
        sessionStorage.setItem(draftKey, val);
      } else {
        sessionStorage.removeItem(draftKey);
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || (schedule && !milestone)) return;
    setPending(true);
    setError(null);
    try {
      let task: Task;
      if (propose) {
        const created = await api<{ task: { id: string } }>(`/projects/${project.id}/proposals`, {
          body: { kind, title, description: description || undefined },
        });
        ({ task } = await api<{ task: Task }>(`/tasks/${created.task.id}`));
      } else {
        const milestoneId = schedule && milestone !== UNSCHEDULED ? milestone : undefined;
        ({ task } = await api<{ task: Task }>(`/projects/${project.id}/tasks`, {
          body: {
            title,
            ...(schedule && statusFromMilestone ? {} : { status }),
            ...(milestoneId ? { milestoneId } : {}),
          },
        }));
      }
      handleTitleChange('');
      setDescription('');
      onCreated(task);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="space-y-2 rounded-card border border-line-control bg-surface p-2.5 shadow-raised"
    >
      <label className="sr-only" htmlFor={`quick-add-${status}`}>
        New task title for {TASK_STATUS_LABEL[status]}
      </label>
      <input
        ref={input}
        id={`quick-add-${status}`}
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder={propose ? 'What should the team do?' : 'Task title'}
        maxLength={200}
        className="h-8 w-full rounded-control border pointer-coarse:h-11 border-line-control bg-surface px-2.5 text-sm placeholder:text-fg-subtle focus-visible:border-primary"
      />
      {propose ? (
        <>
          <label className="sr-only" htmlFor={`quick-add-${status}-description`}>
            Description
          </label>
          <textarea
            id={`quick-add-${status}-description`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Details (optional)"
            maxLength={5000}
            rows={3}
            className="w-full rounded-control border border-line-control bg-surface px-2.5 py-1.5 text-sm placeholder:text-fg-subtle focus-visible:border-primary"
          />
          <SegmentedControl label="Type" value={kind} onChange={setKind} options={PROPOSAL_KINDS} />
          <p className="text-xs text-fg-muted">A project lead reviews proposals in Triage.</p>
        </>
      ) : null}
      {schedule ? (
        <>
          <label className="sr-only" htmlFor={`quick-add-${status}-milestone`}>
            Milestone
          </label>
          <select
            id={`quick-add-${status}-milestone`}
            value={milestone}
            onChange={(e) => setMilestone(e.target.value)}
            className="h-8 w-full rounded-control border pointer-coarse:h-11 border-line-control bg-surface px-2 text-sm text-fg focus-visible:border-primary"
          >
            <option value="" disabled>
              {milestonesQuery.data || milestonesQuery.error
                ? 'Milestone or Unscheduled…'
                : 'Loading milestones…'}
            </option>
            {openMilestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {MILESTONE_STAGE_LABEL[m.status]}
              </option>
            ))}
            <option value={UNSCHEDULED}>Unscheduled</option>
          </select>
          {statusFromMilestone && milestone ? (
            <p className="text-xs text-fg-muted">
              {milestone === UNSCHEDULED ? 'Goes to Backlog.' : 'Goes to To do.'}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={pending}
          disabled={!title.trim() || (schedule && !milestone)}
        >
          {propose ? (pending ? 'Sending…' : 'Propose') : pending ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </form>
  );
}

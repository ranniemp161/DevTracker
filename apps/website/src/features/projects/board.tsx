'use client';

import { TASK_STATUSES, type Task, type TaskStatus } from '@devtrack/types';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { CalendarIcon, PlusIcon } from '@/components/icons';
import {
  Alert,
  Avatar,
  Button,
  ErrorState,
  IconButton,
  PriorityIcon,
  Skeleton,
  StatusDot,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate, PRIORITY_RANK, TASK_STATUS_LABEL } from './labels';
import { LabelChip } from './label-chip';
import { useProject } from './project-context';
import { TaskDetail } from './task-detail';
import { filterTask, TaskFilterBar, useTaskFilters } from './task-filters';
import { TaskStatusMenu } from './task-status-menu';
import { useProjectTasks } from './use-project-tasks';

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTaskId = searchParams.get('task');
  const { project, members, readOnly } = useProject();
  const { tasks, setTasks, error, reload } = useProjectTasks(project.id);
  const { filters } = useTaskFilters();
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);

  const base = `/projects/${project.id}`;

  function openTask(taskId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('task', taskId);
    router.push(`${base}?${next.toString()}`, { scroll: false });
  }

  const closeTask = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('task');
    const qs = next.toString();
    router.push(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [base, router, searchParams]);

  useEffect(() => {
    if (!activeTaskId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeTask();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTaskId, closeTask]);

  async function moveTask(taskId: string, status: TaskStatus) {
    const before = tasks;
    const task = tasks?.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    setDropError(null);
    setTasks((current) => current?.map((t) => (t.id === taskId ? { ...t, status } : t)) ?? null);
    try {
      const { task: updated } = await api<{ task: Task }>(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: { status },
      });
      setTasks((current) => current?.map((t) => (t.id === taskId ? updated : t)) ?? null);
    } catch (err) {
      setTasks(before); // roll back the optimistic move
      setDropError(err instanceof ApiError ? err.message : 'Could not move the task.');
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <TaskFilterBar workspaceId={project.workspaceId} members={members} />
        <div className="flex items-center gap-3">
          <p className="text-label text-fg-muted">
            {doneCount} of {tasks.length} done
          </p>
          <Button variant="ghost" size="sm" onClick={reload}>
            Refresh
          </Button>
          {readOnly ? null : (
            <Button
              variant="primary"
              size="sm"
              icon={<PlusIcon size={14} />}
              onClick={() => setAddingIn('TODO')}
            >
              New task
            </Button>
          )}
        </div>
      </div>
      {dropError ? <Alert>{dropError}</Alert> : null}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-7 sm:px-7">
        <div className="flex w-max gap-3.5">
          {TASK_STATUSES.map((status) => {
            const column = tasks
              .filter((t) => t.status === status && filterTask(t, filters))
              .sort(byPriorityThenAge);
            return (
              <section
                key={status}
                aria-label={TASK_STATUS_LABEL[status]}
                onDragOver={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  setDragOver(status);
                }}
                onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                onDrop={(e) => onDrop(e, status)}
                className={`flex min-h-64 w-68 flex-none flex-col rounded-panel border p-2 transition-all duration-150 ${
                  dragOver === status
                    ? 'border-primary ring-2 ring-primary/30 bg-primary-soft/60 shadow-sm'
                    : 'border-line bg-surface-sunken'
                }`}
              >
                <header className="flex h-8 items-center gap-2 px-1.5">
                  <StatusDot status={status} />
                  <h2 className="text-label font-semibold text-fg">{TASK_STATUS_LABEL[status]}</h2>
                  <span className="text-xs text-fg-muted">{column.length}</span>
                  {readOnly ? null : (
                    <IconButton
                      size="sm"
                      aria-label={`Add task to ${TASK_STATUS_LABEL[status]}`}
                      onClick={() => setAddingIn(status)}
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
                      onCancel={() => setAddingIn(null)}
                      onCreated={(t) => {
                        setTasks((c) => [t, ...(c ?? [])]);
                      }}
                    />
                  ) : null}
                  {column.length === 0 && addingIn !== status ? (
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => !readOnly && setAddingIn(status)}
                      className={`flex h-22 w-full items-center justify-center rounded-card border border-dashed border-line-dashed text-label text-fg-subtle transition-all duration-150 ${
                        readOnly
                          ? ''
                          : 'cursor-pointer hover:border-line-control hover:bg-surface hover:text-fg hover:shadow-xs'
                      }`}
                    >
                      {readOnly ? 'No tasks' : '+ Add task'}
                    </button>
                  ) : null}
                  <ul className="space-y-2">
                    {column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        draggable={!readOnly}
                        onMove={moveTask}
                        onSelect={openTask}
                        readOnly={readOnly}
                      />
                    ))}
                  </ul>
                  {column.length > 0 && addingIn !== status && !readOnly ? (
                    <button
                      type="button"
                      onClick={() => setAddingIn(status)}
                      className="mt-0.5 flex w-full items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg hover:shadow-xs"
                    >
                      <PlusIcon size={13} />
                      <span>Add task</span>
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Slide-over Drawer for Task Details */}
      {activeTaskId ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={closeTask}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Task details"
            className="relative z-10 flex h-full w-full flex-col border-l border-line bg-surface shadow-2xl transition-transform animate-in slide-in-from-right duration-200 ease-out sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
          >
            <TaskDetail
              taskId={activeTaskId}
              onClose={closeTask}
              isDrawer={true}
              onTaskUpdated={(updated) => {
                setTasks(
                  (current) => current?.map((t) => (t.id === updated.id ? updated : t)) ?? null,
                );
              }}
            />
          </aside>
        </div>
      ) : null}
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

function TaskCard({
  task,
  draggable,
  onMove,
  onSelect,
  readOnly,
}: {
  task: Task;
  draggable: boolean;
  onMove: (taskId: string, status: TaskStatus) => void;
  onSelect: (taskId: string) => void;
  readOnly: boolean;
}) {
  const { project } = useProject();
  const [isDragging, setIsDragging] = useState(false);
  const overdue =
    Boolean(task.dueDate) && task.status !== 'DONE' && task.dueDate!.slice(0, 10) < todayIso();
  const shownLabels = task.labels.slice(0, 2);
  const extraLabels = task.labels.length - shownLabels.length;
  const assignees = task.assignees.slice(0, 3);
  const urgent = task.priority === 'URGENT';

  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        setIsDragging(true);
        e.dataTransfer.setData('text/devtrack-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setIsDragging(false)}
      className={`group relative flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5 shadow-card transition-all duration-150 ${
        draggable
          ? 'cursor-grab active:cursor-grabbing hover:-translate-y-0.5 hover:border-line-control hover:shadow-md'
          : ''
      } ${isDragging ? 'scale-[0.98] border-dashed opacity-40 ring-2 ring-primary/40' : ''} ${
        task.status === 'DONE' ? 'opacity-75' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-fg-muted transition-colors group-hover:text-fg">
          {task.key}
        </span>
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
                  className="rounded-full ring-2 ring-surface transition-transform group-hover:scale-105"
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
      {/* Stretched link: click opens drawer, cmd/ctrl-click opens in new tab */}
      <Link
        href={`/projects/${project.id}/tasks/${task.id}`}
        onClick={(e) => {
          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
            e.preventDefault();
            onSelect(task.id);
          }
        }}
        className="line-clamp-3 rounded-chip text-sm leading-snug font-medium text-fg after:absolute after:inset-0 after:rounded-card"
      >
        {task.title}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {urgent ? (
          <span className="inline-flex items-center gap-1 rounded-chip bg-danger-soft px-1.5 py-0.5 text-xs font-semibold text-danger">
            <PriorityIcon priority={task.priority} />
          </span>
        ) : (
          <PriorityIcon priority={task.priority} />
        )}
        {shownLabels.map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
        {extraLabels > 0 ? (
          <span className="rounded-chip bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-fg-muted">
            +{extraLabels}
          </span>
        ) : null}
      </div>
      {task.dueDate ? (
        <div className="border-t border-line-subtle pt-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 ${
              overdue
                ? 'rounded-chip bg-danger-soft px-1.5 py-0.5 font-medium text-danger'
                : 'text-fg-muted'
            }`}
          >
            <CalendarIcon size={13} />
            {overdue ? 'Overdue · ' : ''}
            {formatDate(task.dueDate)}
          </span>
        </div>
      ) : null}
    </li>
  );
}

/** Inline quick-add in a column; the task is created with that column's status. */
function ColumnQuickAdd({
  status,
  onCreated,
  onCancel,
}: {
  status: TaskStatus;
  onCreated: (task: Task) => void;
  onCancel: () => void;
}) {
  const { project } = useProject();
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

  useEffect(() => input.current?.focus(), []);

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
    if (!title.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const { task } = await api<{ task: Task }>(`/projects/${project.id}/tasks`, {
        body: { title: title.trim(), status },
      });
      handleTitleChange('');
      onCreated(task);
      setTimeout(() => input.current?.focus(), 50);
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
      className="space-y-2 rounded-card border border-primary/50 bg-surface p-2.5 shadow-raised ring-1 ring-primary/20"
    >
      <label className="sr-only" htmlFor={`quick-add-${status}`}>
        New task title for {TASK_STATUS_LABEL[status]}
      </label>
      <input
        ref={input}
        id={`quick-add-${status}`}
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="Task title… (Enter to add)"
        maxLength={200}
        className="h-8 w-full rounded-control border border-line-control bg-surface px-2.5 text-sm placeholder:text-fg-subtle focus-visible:border-primary"
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[11px] text-fg-subtle">Enter to add · Esc</span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={pending}
            disabled={!title.trim()}
          >
            {pending ? 'Adding…' : 'Add task'}
          </Button>
        </div>
      </div>
    </form>
  );
}

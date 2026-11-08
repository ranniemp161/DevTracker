'use client';

import { TASK_STATUSES, type Task, type TaskStatus } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
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
  const { project, members, readOnly } = useProject();
  const { tasks, setTasks, error, reload } = useProjectTasks(project.id);
  const { filters } = useTaskFilters();
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);

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
        <TaskFilterBar workspaceId={project.workspaceId} projectId={project.id} members={members} />
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
                className={`flex min-h-64 w-68 flex-none flex-col rounded-panel border p-2 transition-colors ${
                  dragOver === status
                    ? 'border-primary bg-primary-soft'
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
                        setAddingIn(null);
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
                        onMove={moveTask}
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
  readOnly,
}: {
  task: Task;
  draggable: boolean;
  onMove: (taskId: string, status: TaskStatus) => void;
  readOnly: boolean;
}) {
  const { project } = useProject();
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
      className={`relative flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-line-control ${
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
      <Link
        href={`/projects/${project.id}/tasks/${task.id}`}
        className="line-clamp-3 rounded-chip text-sm leading-snug font-medium text-fg after:absolute after:inset-0 after:rounded-card"
      >
        {task.title}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <PriorityIcon priority={task.priority} />
        {shownLabels.map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
        {extraLabels > 0 ? <span className="text-xs text-fg-muted">+{extraLabels}</span> : null}
      </div>
      {task.dueDate ? (
        <div className="border-t border-line-subtle pt-2 text-xs text-fg-muted">
          <span
            className={`inline-flex items-center gap-1.5 ${overdue ? 'font-medium text-danger' : ''}`}
          >
            <CalendarIcon size={14} />
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
    if (!title.trim()) return;
    setPending(true);
    setError(null);
    try {
      const { task } = await api<{ task: Task }>(`/projects/${project.id}/tasks`, {
        body: { title, status },
      });
      handleTitleChange('');
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
        placeholder="Task title"
        maxLength={200}
        className="h-8 w-full rounded-control border border-line-control bg-surface px-2.5 text-sm placeholder:text-fg-subtle focus-visible:border-primary"
      />
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
          disabled={!title.trim()}
        >
          {pending ? 'Adding…' : 'Add task'}
        </Button>
      </div>
    </form>
  );
}

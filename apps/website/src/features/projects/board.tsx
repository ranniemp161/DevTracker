'use client';

import { TASK_STATUSES, type Task, type TaskStatus } from '@devtrack/types';
import Link from 'next/link';
import { useState, type DragEvent, type FormEvent } from 'react';
import { Alert, Avatar, Badge, Button, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  formatDate,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
} from './labels';
import { LabelChip } from './label-chip';
import { useProject } from './project-context';
import { filterTask, TaskFilterBar, useTaskFilters } from './task-filters';
import { useProjectTasks } from './use-project-tasks';

const byPriorityThenAge = (a: Task, b: Task) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  BACKLOG: 'bg-neutral-400',
  TODO: 'bg-amber-500',
  IN_PROGRESS: 'bg-sky-500',
  IN_REVIEW: 'bg-indigo-500',
  DONE: 'bg-emerald-500',
  BLOCKED: 'bg-red-500',
};

/** Kanban view: one column per status; dropping a card in a column changes its status (M3 rule 8). */
export function Board() {
  const { project, members, readOnly } = useProject();
  const { tasks, setTasks, error, reload } = useProjectTasks(project.id);
  const { filters } = useTaskFilters();
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

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

  if (error) {
    return (
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Button size="sm" variant="secondary" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  if (!tasks) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex gap-4 overflow-x-hidden pb-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="w-[280px] shrink-0 rounded-xl border border-border bg-subtle/50 p-3 space-y-3"
            >
              <Skeleton className="h-6 w-24 rounded" />
              <Skeleton className="h-28 rounded-lg" />
              <Skeleton className="h-28 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Consolidated toolbar: Filters + Refresh action */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <TaskFilterBar workspaceId={project.workspaceId} members={members} />
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={reload}
            className="text-xs text-mineral hover:text-graphite"
            title="Refresh tasks"
          >
            <svg aria-hidden="true" className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.75a.75.75 0 00-.75.75v4.482a.75.75 0 001.5 0v-2.433l.311.313a7 7 0 0011.712-3.138.75.75 0 00-1.21-.629zM4.688 8.576a5.5 5.5 0 019.201-2.466l.312.311H11.77a.75.75 0 000 1.5h4.482a.75.75 0 00.75-.75V2.689a.75.75 0 00-1.5 0v2.433l-.311-.313A7 7 0 003.478 7.947a.75.75 0 001.21.629z"
                clipRule="evenodd"
              />
            </svg>
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Quick Add Bar */}
      {readOnly ? null : <QuickAdd onCreated={(t) => setTasks((c) => [t, ...(c ?? [])])} />}

      {dropError ? <Alert>{dropError}</Alert> : null}

      {/* Board columns container: scrollable horizontally, keeping comfortable 280px column width */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 overflow-x-auto px-4 sm:px-6 lg:px-8 pb-4 custom-scrollbar">
        <div className="flex items-start gap-3.5 min-w-max">
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
                className={`flex w-[280px] sm:w-[290px] shrink-0 flex-col rounded-xl border p-2.5 transition-colors duration-150 ${
                  dragOver === status
                    ? 'border-accent bg-accent-tint/40 shadow-xs'
                    : 'border-border/90 bg-subtle/50'
                }`}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-2 py-1.5 mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${STATUS_DOT_COLORS[status]}`}
                      aria-hidden="true"
                    />
                    <h2 className="text-xs font-semibold text-graphite tracking-tight">
                      {TASK_STATUS_LABEL[status]}
                    </h2>
                  </div>
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-mineral shadow-xs">
                    {column.length}
                  </span>
                </div>

                {/* Cards list */}
                <ul className="space-y-2.5 min-h-[120px]">
                  {column.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      draggable={!readOnly}
                      onMove={moveTask}
                      readOnly={readOnly}
                    />
                  ))}
                  {column.length === 0 ? (
                    <li className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-center text-xs text-mineral-muted">
                      No tasks in {TASK_STATUS_LABEL[status].toLowerCase()}
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
        </div>
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

  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/devtrack-task', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="group rounded-xl border border-border bg-surface p-3 shadow-xs transition-all duration-150 hover:border-border-strong hover:shadow-sm"
    >
      {/* Header: Key & Accessible Status changer */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/projects/${project.id}/tasks/${task.id}`}
          className="font-mono text-xs font-semibold text-mineral group-hover:text-accent transition-colors"
        >
          {task.key}
        </Link>
        {!readOnly ? (
          <label className="text-xs shrink-0">
            <span className="sr-only">Change status for {task.key}</span>
            <select
              value={task.status}
              onChange={(e) => onMove(task.id, e.target.value as TaskStatus)}
              className="rounded-md border border-border/80 bg-subtle/50 px-1.5 py-0.5 text-[11px] font-medium text-mineral transition-colors hover:border-border-strong hover:bg-white focus:border-accent focus:outline-none cursor-pointer"
              title="Move to status"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {/* Body: Title, Labels, Priority, Assignees */}
      <Link href={`/projects/${project.id}/tasks/${task.id}`} className="mt-2 block space-y-2.5">
        <p className="text-sm font-medium leading-snug text-graphite group-hover:text-accent-text transition-colors">
          {task.title}
        </p>

        {task.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {task.labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
          <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
          <div className="flex items-center gap-2">
            {task.dueDate ? (
              <span className="text-[11px] text-mineral-muted font-medium">
                {formatDate(task.dueDate)}
              </span>
            ) : null}
            <div className="flex -space-x-1">
              {task.assignees.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  title={`@${a.username}`}
                  className="rounded-full ring-1 ring-surface"
                >
                  <Avatar name={a.username} url={a.avatarUrl} size="xs" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function QuickAdd({ onCreated }: { onCreated: (task: Task) => void }) {
  const { project } = useProject();
  const draftKey = `devtrack_task_draft_${project.id}`;
  const [title, setTitle] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(draftKey) ?? '';
    }
    return '';
  });
  const [status, setStatus] = useState<TaskStatus>('TODO');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onCreated(task);
      handleTitleChange('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the task.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2.5 shadow-xs"
    >
      <label className="sr-only" htmlFor="quick-add-title">
        New task title
      </label>
      <input
        id="quick-add-title"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder={`Add a task to ${project.key}…`}
        maxLength={200}
        className="min-w-64 flex-1 rounded-lg border border-border bg-subtle/30 px-3 py-1.5 text-xs text-graphite placeholder:text-mineral-muted focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15"
      />
      <label className="sr-only" htmlFor="quick-add-status">
        Status
      </label>
      <select
        id="quick-add-status"
        value={status}
        onChange={(e) => setStatus(e.target.value as TaskStatus)}
        className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-medium text-graphite focus:border-accent focus:outline-none cursor-pointer"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <Button type="submit" variant="primary" size="sm" disabled={pending || !title.trim()}>
        {pending ? 'Adding…' : 'Add task'}
      </Button>
      {error ? <p className="w-full text-xs font-medium text-red-600 px-1">{error}</p> : null}
    </form>
  );
}

'use client';

import { TASK_STATUSES, type Task, type TaskStatus } from '@devtrack/types';
import Link from 'next/link';
import { useState, type DragEvent, type FormEvent } from 'react';
import { Alert, Avatar, Badge, Button } from '@/components/ui';
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

  if (error) return <Alert>{error}</Alert>;
  if (!tasks) return <p className="text-sm text-neutral-500">Loading tasks…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TaskFilterBar workspaceId={project.workspaceId} members={members} />
      </div>
      {readOnly ? null : <QuickAdd onCreated={(t) => setTasks((c) => [t, ...(c ?? [])])} />}
      {dropError ? <Alert>{dropError}</Alert> : null}
      <div className="-mx-6 overflow-x-auto px-6 pb-2">
        <div className="grid min-w-[1080px] grid-cols-6 gap-3">
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
                className={`flex min-h-64 flex-col rounded-lg border p-2 ${
                  dragOver === status
                    ? 'border-neutral-900 bg-neutral-100'
                    : 'border-neutral-200 bg-neutral-100/60'
                }`}
              >
                <h2 className="flex items-center justify-between px-1 pb-2 text-xs font-semibold tracking-wide text-neutral-600 uppercase">
                  {TASK_STATUS_LABEL[status]}
                  <span className="rounded-full bg-white px-2 py-0.5 text-neutral-500">
                    {column.length}
                  </span>
                </h2>
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
              </section>
            );
          })}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={reload}>
        Refresh
      </Button>
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
      className="group rounded-md border border-neutral-200 bg-white p-2.5 shadow-xs transition hover:border-neutral-300"
    >
      <div className="flex items-start justify-between gap-1.5">
        <Link
          href={`/projects/${project.id}/tasks/${task.id}`}
          className="text-xs font-medium text-neutral-500 hover:underline"
        >
          {task.key}
        </Link>
        {!readOnly ? (
          <label className="text-xs">
            <span className="sr-only">Change status for {task.key}</span>
            <select
              value={task.status}
              onChange={(e) => onMove(task.id, e.target.value as TaskStatus)}
              className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px] font-medium text-neutral-600 focus:border-neutral-900 focus:outline-none"
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
      <Link href={`/projects/${project.id}/tasks/${task.id}`} className="mt-1 block space-y-2">
        <p className="text-sm font-medium leading-snug text-neutral-900">{task.title}</p>
        {task.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {task.labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Badge tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
          <div className="flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((a) => (
              <span key={a.id} title={`@${a.username}`} className="rounded-full ring-2 ring-white">
                <Avatar name={a.username} url={a.avatarUrl} size="sm" />
              </span>
            ))}
          </div>
        </div>
        {task.dueDate ? (
          <p className="text-xs text-neutral-500">Due {formatDate(task.dueDate)}</p>
        ) : null}
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
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="quick-add-title">
        New task title
      </label>
      <input
        id="quick-add-title"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder={`Add a task to ${project.key}…`}
        maxLength={200}
        className="min-w-64 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
      />
      <label className="sr-only" htmlFor="quick-add-status">
        Status
      </label>
      <select
        id="quick-add-status"
        value={status}
        onChange={(e) => setStatus(e.target.value as TaskStatus)}
        className="rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <Button type="submit" variant="primary" disabled={pending || !title.trim()}>
        {pending ? 'Adding…' : 'Add task'}
      </Button>
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

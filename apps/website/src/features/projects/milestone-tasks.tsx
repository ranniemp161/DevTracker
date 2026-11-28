'use client';

import type { Milestone, Task } from '@devtrack/types';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PlusIcon } from '@/components/icons';
import { Avatar, Badge, Button, StatusDot } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { TASK_STATUS_LABEL } from './labels';
import { AssigneeSelect, useTaskAddedToast } from './task-adding';

/**
 * The milestone's tasks (0030 §3): open first, then Done. People who create tasks directly add
 * new ones straight into it, optionally assigned. With no status sent, a task in a milestone
 * starts in To do (0024 §4); assigning notifies as usual.
 */
export function MilestoneTasks({
  milestone: m,
  projectId,
  tasks,
  canAdd,
  autoFocus = false,
  onAdded,
}: {
  milestone: Milestone;
  projectId: string;
  /** The project's tasks, or null while they load. */
  tasks: Task[] | null;
  canAdd: boolean;
  autoFocus?: boolean;
  onAdded: (task: Task) => void;
}) {
  const taskAdded = useTaskAddedToast();
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = (tasks ?? []).filter((t) => t.milestoneId === m.id);
  const open = mine.filter((t) => t.status !== 'DONE');
  const done = mine.filter((t) => t.status === 'DONE');
  // Delivered milestones take no new tasks (0025 §2).
  const adding = canAdd && m.status !== 'DELIVERED';

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { task } = await api<{ task: Task }>(`/projects/${projectId}/tasks`, {
        body: {
          title: title.trim(),
          milestoneId: m.id,
          ...(assigneeId ? { assigneeIds: [assigneeId] } : {}),
        },
      });
      setTitle('');
      onAdded(task);
      taskAdded(task);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Could not add the task.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`${m.name} tasks`} className="mt-4 space-y-2">
      <h3 className="text-label font-medium text-fg-secondary">
        Tasks
        {tasks ? (
          <span className="font-normal text-fg-muted">
            {' '}
            · {open.length} open{done.length > 0 ? `, ${done.length} done` : ''}
          </span>
        ) : null}
      </h3>
      {tasks && mine.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          {adding ? 'Break the delivery into tasks and hand them out.' : 'No tasks yet.'}
        </p>
      ) : null}
      {mine.length > 0 ? (
        <ul className="space-y-1">
          {[...open, ...done].map((t) => (
            <li key={t.id}>
              <Link
                href={`/projects/${projectId}/tasks/${t.id}`}
                className="flex items-center gap-2 rounded-control px-1 py-0.5 text-sm hover:bg-surface-sunken pointer-coarse:py-2"
              >
                <StatusDot status={t.status} />
                <span className="sr-only">{TASK_STATUS_LABEL[t.status]}:</span>
                <span className="shrink-0 text-xs text-fg-muted">{t.key}</span>
                <span
                  className={`min-w-0 flex-1 truncate ${t.status === 'DONE' ? 'text-fg-muted line-through' : 'text-fg'}`}
                >
                  {t.title}
                </span>
                {/* 0025 §3: scope that joined once the milestone was Active. */}
                {t.addedAfterStart ? <Badge tone="amber">Added after start</Badge> : null}
                {t.assignees.length === 0 ? (
                  <span className="text-xs text-fg-subtle">Unassigned</span>
                ) : (
                  t.assignees
                    .slice(0, 3)
                    .map((a) => (
                      <Avatar
                        key={a.id}
                        name={a.username}
                        url={a.avatarUrl}
                        seed={a.id}
                        size="xs"
                      />
                    ))
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <form onSubmit={add} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`milestone-task-${m.id}`} className="sr-only">
            New task in {m.name}
          </label>
          <input
            id={`milestone-task-${m.id}`}
            value={title}
            maxLength={200}
            autoFocus={autoFocus}
            placeholder="Add a task to this milestone"
            onChange={(e) => setTitle(e.target.value)}
            className="block h-7.5 min-w-0 flex-1 basis-56 rounded-control border border-line-control bg-surface px-2.5 text-label text-fg transition-colors placeholder:text-fg-subtle focus-visible:border-primary pointer-coarse:h-11"
          />
          <AssigneeSelect
            id={`milestone-task-${m.id}-assignee`}
            value={assigneeId}
            onChange={setAssigneeId}
            className="h-7.5 max-w-48 pointer-coarse:h-11"
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || !title.trim()}
            icon={<PlusIcon size={14} />}
          >
            Add task
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}

'use client';

import type { MyTask, MyTasksResponse, TaskStatus } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/toaster';
import { Alert, EmptyState, ErrorState, PriorityIcon, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh, useRealtimeRoom } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useWorkspace } from '../workspaces/workspace-context';
import { formatDate, TASK_STATUS_LABEL } from './labels';
import { DUE_GROUP_LABEL, groupByDue, localDate } from './my-tasks-groups';
import { TaskStatusMenu } from './task-status-menu';

/** Open tasks assigned to me in this workspace, grouped by when they're due. */
export function MyTasksPage() {
  const { workspace } = useWorkspace();
  const query = useApiQuery<MyTasksResponse>(`/workspaces/${workspace.id}/my-tasks`);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  // Undo runs after later reloads; it must see the list as it is then.
  const latest = useRef(query.data);
  useEffect(() => {
    latest.current = query.data;
  }, [query.data]);

  const { reload } = query;
  // Task events arrive per project; a new assignment arrives as a notification to me.
  useRealtimeRefresh(
    (e) =>
      e.type.startsWith('notification.') ||
      (e.workspaceId === workspace.id && e.type.startsWith('task.')),
    reload,
  );

  async function setStatus(task: MyTask, status: TaskStatus, { isUndo = false } = {}) {
    if (task.status === status) return;
    setError(null);
    try {
      await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: { status } });
      reload();
      if (isUndo) {
        toast.show(`Moved ${task.key} back to ${TASK_STATUS_LABEL[status]}`);
      } else {
        toast.show(`Moved ${task.key} to ${TASK_STATUS_LABEL[status]}`, {
          label: 'Undo',
          onClick: () => undo(task, status),
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the status.');
    }
  }

  /** Moves a task back, unless someone changed it again after our change. */
  async function undo(task: MyTask, movedTo: TaskStatus) {
    const current = latest.current?.tasks.find((t) => t.id === task.id);
    // A task moved to Done leaves this list, so "not found" can still be ours to undo.
    if (current && current.status !== movedTo) {
      toast.show(`${task.key} changed again since, so it wasn't moved back.`);
      return;
    }
    await setStatus({ ...task, status: movedTo }, task.status, { isUndo: true });
  }

  if (query.error) return <ErrorState message={query.error.message} onRetry={reload} />;
  if (!query.data) {
    return (
      <div role="status" aria-label="Loading your tasks" className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  const { tasks, hasMore } = query.data;
  const groups = groupByDue(tasks, localDate(new Date()));
  const projectIds = [...new Set(tasks.map((t) => t.project.id))];

  return (
    <div className="space-y-6">
      {projectIds.map((id) => (
        <ProjectRoom key={id} projectId={id} />
      ))}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-fg">My tasks</h2>
        <p className="text-label text-fg-muted">
          {hasMore ? `${tasks.length}+ open` : `${tasks.length} open`}
        </p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {tasks.length === 0 ? (
        <EmptyState>Nothing assigned to you is open in this workspace.</EmptyState>
      ) : (
        groups.map(({ group, tasks: inGroup }) => (
          <section key={group} aria-labelledby={`due-${group}`} className="space-y-2">
            <h3
              id={`due-${group}`}
              className={`text-label font-medium ${group === 'overdue' ? 'text-danger' : 'text-fg-muted'}`}
            >
              {DUE_GROUP_LABEL[group]} <span className="font-normal">· {inGroup.length}</span>
            </h3>
            <ul className="divide-y divide-line-subtle rounded-card border border-line bg-surface">
              {inGroup.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <TaskStatusMenu status={t.status} onSelect={(s) => void setStatus(t, s)} />
                  <span className="font-mono text-xs whitespace-nowrap text-fg-muted">{t.key}</span>
                  <Link
                    href={`/projects/${t.project.id}/tasks/${t.id}`}
                    className="min-w-0 flex-1 truncate font-medium text-fg hover:underline"
                  >
                    {t.title}
                  </Link>
                  <span className="text-label text-fg-muted">{t.project.name}</span>
                  <PriorityIcon priority={t.priority} />
                  <span
                    className={`text-label whitespace-nowrap ${group === 'overdue' ? 'text-danger' : 'text-fg-muted'}`}
                  >
                    {t.dueDate ? formatDate(t.dueDate) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {hasMore ? (
        <p className="text-label text-fg-muted">
          Showing your 100 most urgent open tasks. Open a project to see the rest.
        </p>
      ) : null}
    </div>
  );
}

/** Joins one project's realtime room while its tasks are listed. */
function ProjectRoom({ projectId }: { projectId: string }) {
  useRealtimeRoom(`project:${projectId}`);
  return null;
}

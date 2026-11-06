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
import { useState, type FormEvent } from 'react';
import { Alert, Avatar, Button, Card, Field, Select } from '@/components/ui';
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

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const query = useApiQuery<{ task: Task }>(`/tasks/${taskId}`);
  // Live updates (M7): refetch when this task changes elsewhere.
  useRealtimeRefresh((e) => e.type.startsWith('task.') && e.entity.id === taskId, query.reload);
  const { project } = useProject();
  // Bumped after comments/edits so the History list re-fetches.
  const [history, setHistory] = useState(0);
  const bumpHistory = () => setHistory((h) => h + 1);

  if (query.error) {
    return (
      <div className="space-y-3">
        <Alert>
          {query.error.status === 404
            ? 'This task does not exist or was deleted.'
            : query.error.message}
        </Alert>
        <Link href={`/projects/${project.id}`} className="text-sm underline">
          Back to board
        </Link>
      </div>
    );
  }
  if (!query.data) return <p className="text-sm text-neutral-500">Loading task…</p>;
  const task = query.data.task;
  // Re-mount the editor when the task changes on the server so the form shows fresh values.
  return (
    <div className="space-y-8">
      <TaskEditor
        key={task.updatedAt}
        task={task}
        onSaved={() => {
          query.reload();
          bumpHistory();
        }}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <CommentThread task={task} onActivity={bumpHistory} />
        <div className="space-y-6">
          <TaskPullRequests task={task} onChange={bumpHistory} />
          <Card title="History">
            <ActivityFeed
              projectId={project.id}
              taskId={task.id}
              limit={15}
              refreshKey={`${task.updatedAt}:${history}`}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function TaskEditor({ task, onSaved }: { task: Task; onSaved: () => void }) {
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
    void call(() => api(`/tasks/${task.id}`, { method: 'PATCH', body }));
  }

  const unassigned = members.filter((m) => !task.assignees.some((a) => a.id === m.user.id));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <form onSubmit={save} className="space-y-4">
        <Link href={`/projects/${project.id}`} className="text-sm text-neutral-600 hover:underline">
          ← Board
        </Link>
        <p className="text-sm font-medium text-neutral-500">{task.key}</p>
        {error ? <Alert>{error}</Alert> : null}
        <Field
          label="Title"
          name="title"
          value={form.title}
          disabled={readOnly}
          maxLength={200}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <div className="space-y-1.5">
          <label htmlFor="field-description" className="block text-sm font-medium text-neutral-800">
            Description
          </label>
          <textarea
            id="field-description"
            rows={8}
            value={form.description}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Status"
            name="status"
            value={form.status}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TaskStatus }))}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select
            label="Priority"
            name="priority"
            value={form.priority}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
          <Field
            label="Due date"
            name="dueDate"
            type="date"
            value={form.dueDate}
            disabled={readOnly}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
        </div>
        {readOnly ? null : (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {canDelete ? (
              confirmDelete ? (
                <>
                  <Button
                    variant="danger"
                    disabled={saving}
                    onClick={() =>
                      call(
                        () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
                        () => router.push(`/projects/${project.id}`),
                      )
                    }
                  >
                    Confirm delete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  Delete task
                </Button>
              )
            ) : null}
          </div>
        )}
      </form>

      <aside className="space-y-4">
        <TaskLabels task={task} onChanged={onSaved} />
        <Card title="Assignees">
          <ul className="space-y-2">
            {task.assignees.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <Avatar name={a.username} url={a.avatarUrl} size="sm" />
                <span className="flex-1">@{a.username}</span>
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
              <li className="text-sm text-neutral-500">Nobody yet.</li>
            ) : null}
          </ul>
          {!readOnly && unassigned.length > 0 ? (
            <label className="mt-3 block text-sm">
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
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Assign someone…</option>
                {unassigned.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    @{m.user.username}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Card>
        <Card>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-neutral-500">Reporter</dt>
              <dd>{task.reporter ? `@${task.reporter.username}` : '—'}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Created</dt>
              <dd>{formatDate(task.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Updated</dt>
              <dd>{formatDate(task.updatedAt)}</dd>
            </div>
            {task.completedAt ? (
              <div>
                <dt className="text-neutral-500">Completed</dt>
                <dd>{formatDate(task.completedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </aside>
    </div>
  );
}

'use client';

import { MILESTONE_STAGES, type Milestone, type Task } from '@devtrack/types';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ChevronRightIcon, FlagIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Alert, Badge, Button, Field, SegmentedControl, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import {
  dueLabel,
  dueTone,
  isReadyForReview,
  MILESTONE_STAGE_LABEL,
  MILESTONE_STAGE_TONE,
} from './labels';
import { MilestoneCriteria, MilestoneProgress } from './milestone-criteria';
import { MilestoneReleases } from './milestone-releases';
import { MilestoneSignoff } from './milestone-signoff';
import { MilestoneTasks } from './milestone-tasks';
import { useProject } from './project-context';
import { useProjectTasks } from './use-project-tasks';

/** 0030 §5: the milestone description holds a whole brief. */
const MAX_DESCRIPTION = 20_000;

/**
 * The milestone as a brief (decision record 0030 §3): the goal and description, acceptance
 * criteria, the tasks with their assignees, then releases and the client's sign-off.
 */
export function MilestonePage() {
  const { milestoneId } = useParams<{ milestoneId: string }>();
  const { project, readOnly } = useProject();
  const canManage = project.viewerCanManage && !readOnly;
  const query = useApiQuery<{ milestone: Milestone }>(`/milestones/${milestoneId}`);
  const { tasks, setTasks } = useProjectTasks(project.id);
  // Anyone who creates tasks directly can add them; proposers go through Triage (0024 §2).
  const canAddTasks = !readOnly && !project.viewerMustPropose;
  // New task → an existing milestone lands here with the Add task box focused (0030 §2).
  const focusAdd = useSearchParams().get('add') === '1';
  const listHref = `/projects/${project.id}/milestones`;

  const back = (
    <Link
      href={listHref}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg"
    >
      <ChevronRightIcon size={14} className="rotate-180" />
      All milestones
    </Link>
  );

  if (query.error) {
    return (
      <div className="space-y-3">
        {back}
        <Alert>
          {query.error.status === 404
            ? 'This milestone does not exist or was deleted.'
            : query.error.message}
        </Alert>
      </div>
    );
  }
  const m = query.data?.milestone;
  if (!m) {
    return (
      <div role="status" aria-label="Loading milestone" className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  function taskAdded(task: Task) {
    setTasks((current) => [task, ...(current ?? [])]);
    query.reload();
  }

  return (
    <div className="space-y-4">
      {back}
      <MilestoneHeader milestone={m} canManage={canManage} onChanged={query.reload} />
      <Panel title="Description">
        <MilestoneDescription milestone={m} canManage={canManage} onSaved={query.reload} />
      </Panel>
      <Panel>
        <MilestoneCriteria milestone={m} canManage={canManage} onChanged={query.reload} />
        {m.criteria.length === 0 && !canManage ? (
          <>
            <h3 className="text-label font-medium text-fg-secondary">Acceptance criteria</h3>
            <p className="mt-2 text-sm text-fg-subtle">No acceptance criteria yet.</p>
          </>
        ) : null}
      </Panel>
      <Panel>
        <MilestoneTasks
          milestone={m}
          projectId={project.id}
          tasks={tasks}
          canAdd={canAddTasks}
          autoFocus={focusAdd}
          onAdded={taskAdded}
        />
      </Panel>
      <MilestoneExtras milestone={m} canManage={canManage} onChanged={query.reload} />
    </div>
  );
}

function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-card border border-line bg-surface p-4 *:first:mt-0 sm:p-5"
    >
      {title ? <h2 className="mb-2 text-label font-medium text-fg-secondary">{title}</h2> : null}
      {children}
    </section>
  );
}

/** Releases (0026) and sign-off (0028) only show once there's something to show. */
function MilestoneExtras({
  milestone: m,
  canManage,
  onChanged,
}: {
  milestone: Milestone;
  canManage: boolean;
  onChanged: () => void;
}) {
  return (
    <section
      aria-label="Delivery"
      className="rounded-card border border-line bg-surface p-4 *:first:mt-0 empty:hidden sm:p-5"
    >
      <MilestoneReleases milestone={m} canManage={canManage} onChanged={onChanged} />
      <MilestoneSignoff milestone={m} canManage={canManage} />
    </section>
  );
}

/** Name (the goal), stage, due date, progress and the "ready for review" prompt (0025 §4). */
function MilestoneHeader({
  milestone: m,
  canManage,
  onChanged,
}: {
  milestone: Milestone;
  canManage: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { project } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const delivered = m.status === 'DELIVERED';

  async function call(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/milestones/${m.id}`, { method: 'DELETE' });
      router.push(`/projects/${project.id}/milestones`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the milestone.');
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Milestone"
      className="rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <FlagIcon
          size={20}
          className={`mt-1 shrink-0 ${delivered ? 'text-status-done' : 'text-fg-subtle'}`}
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <DetailsForm
              milestone={m}
              busy={busy}
              onCancel={() => setEditing(false)}
              onSave={(body) =>
                call(
                  () => api(`/milestones/${m.id}`, { method: 'PATCH', body }),
                  () => setEditing(false),
                )
              }
            />
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1 basis-48">
                <h2 className={`text-xl font-semibold ${delivered ? 'text-fg-muted' : 'text-fg'}`}>
                  {m.name}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {canManage ? null : (
                    <Badge tone={MILESTONE_STAGE_TONE[m.status]}>
                      {MILESTONE_STAGE_LABEL[m.status]}
                    </Badge>
                  )}
                  <span className={m.dueDate ? dueTone(m.dueDate, delivered) : 'text-fg-subtle'}>
                    {m.dueDate ? dueLabel(m.dueDate, delivered) : 'No due date'}
                  </span>
                </p>
              </div>
              {canManage ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`stage-${m.id}`}>
                    Stage of {m.name}
                  </label>
                  <select
                    id={`stage-${m.id}`}
                    value={m.status}
                    disabled={busy}
                    onChange={(e) =>
                      call(() =>
                        api(`/milestones/${m.id}`, {
                          method: 'PATCH',
                          body: { status: e.target.value },
                        }),
                      )
                    }
                    className="h-7.5 rounded-control border border-line-control bg-surface px-2 text-label font-medium text-fg focus-visible:border-primary"
                  >
                    {MILESTONE_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {MILESTONE_STAGE_LABEL[stage]}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          {canManage ? <ReadyBanner milestone={m} busy={busy} onMove={call} /> : null}
          <MilestoneProgress milestone={m} projectId={project.id} />
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${m.name}?`}
        confirmLabel="Delete milestone"
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      >
        Its tasks stay on the board without a milestone. Its acceptance criteria are deleted.
      </ConfirmDialog>
    </section>
  );
}

function DetailsForm({
  milestone: m,
  busy,
  onSave,
  onCancel,
}: {
  milestone: Milestone;
  busy: boolean;
  onSave: (body: { name: string; dueDate: string | null }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(m.name);
  const [dueDate, setDueDate] = useState(m.dueDate ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), dueDate: dueDate || null });
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-0 flex-1 basis-56">
        <Field
          label="Goal"
          name="milestone-name"
          value={name}
          maxLength={100}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Field
        label="Due date"
        name="milestone-due"
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** 0025 §4: an Active milestone with everything done prompts the move to Client review. */
function ReadyBanner({
  milestone: m,
  busy,
  onMove,
}: {
  milestone: Milestone;
  busy: boolean;
  onMove: (fn: () => Promise<unknown>) => void;
}) {
  const ready = isReadyForReview(m);
  const readyKey = `devtrack:milestone-review-dismissed:${m.id}`;
  const fingerprint = `${m.status}:${m.taskCounts.total}:${m.taskCounts.done}:${m.criteria.map((c) => `${c.id}:${c.done}`).join(',')}`;
  const [, setDismissTick] = useState(0);
  useEffect(() => {
    if (ready) return;
    try {
      window.localStorage.removeItem(readyKey);
    } catch {
      // Ignore storage errors.
    }
  }, [ready, readyKey]);

  if (!ready) return null;
  let dismissedFor: string | null;
  try {
    dismissedFor = window.localStorage.getItem(readyKey);
  } catch {
    dismissedFor = null;
  }
  if (dismissedFor === fingerprint) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(readyKey, fingerprint);
    } catch {
      // Ignore storage errors.
    }
    setDismissTick((n) => n + 1);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm">
      <span className="font-medium text-fg">Everything is done. Move to Client review?</span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() =>
            onMove(() =>
              api(`/milestones/${m.id}`, { method: 'PATCH', body: { status: 'CLIENT_REVIEW' } }),
            )
          }
        >
          Move to Client review
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={dismiss}>
          Not yet
        </Button>
      </div>
    </div>
  );
}

/** The brief, in Markdown (0030 §3): leads and admins write it; everyone reads it. */
function MilestoneDescription({
  milestone: m,
  canManage,
  onSaved,
}: {
  milestone: Milestone;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(m.description ?? '');
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = m.description ?? '';

  function startEditing() {
    setValue(saved);
    setTab('write');
    setError(null);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/milestones/${m.id}`, { method: 'PATCH', body: { description: value } });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        {saved.trim() ? (
          <Markdown>{saved}</Markdown>
        ) : (
          <p className="text-sm text-fg-subtle">
            {canManage
              ? 'Describe the goal: what the client gets, for whom, and anything the team should know.'
              : 'No description yet.'}
          </p>
        )}
        {canManage ? (
          <Button size="sm" onClick={startEditing}>
            {saved.trim() ? 'Edit description' : 'Write description'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-control border border-line focus-within:border-primary">
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
          <span className="hidden text-xs text-fg-subtle sm:inline">Markdown supported</span>
        </div>
        {tab === 'write' ? (
          <>
            <label htmlFor={`milestone-description-${m.id}`} className="sr-only">
              Description
            </label>
            <textarea
              id={`milestone-description-${m.id}`}
              rows={8}
              value={value}
              maxLength={MAX_DESCRIPTION}
              autoFocus
              placeholder="The goal, who it's for, scope, links to designs… Markdown works: **bold**, - lists, `code`, [links](https://…)"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              className="block min-h-40 w-full resize-none rounded-b-control bg-transparent px-3 py-2 field-sizing-content text-base leading-relaxed text-fg-secondary placeholder:text-fg-subtle focus-visible:shadow-none! lg:text-sm"
            />
          </>
        ) : (
          <div className="min-h-40 px-3 py-2">
            {value.trim() ? (
              <Markdown>{value}</Markdown>
            ) : (
              <p className="text-sm text-fg-subtle">Nothing to preview.</p>
            )}
          </div>
        )}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-fg-subtle">
          {value.length.toLocaleString()} / {MAX_DESCRIPTION.toLocaleString()}
        </span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={busy || value === saved}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

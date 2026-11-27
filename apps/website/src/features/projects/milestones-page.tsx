'use client';

import { MILESTONE_STAGES, type Milestone, type MilestoneStatus } from '@devtrack/types';
import { createMilestoneSchema } from '@devtrack/validators';
import { useEffect, useState } from 'react';
import { FlagIcon, PlusIcon } from '@/components/icons';
import { Alert, Badge, Button, EmptyState, Field, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useAuthForm, withoutBlanks } from '../auth/use-auth-form';
import { formatDate, isReadyForReview, MILESTONE_STAGE_LABEL } from './labels';
import { MilestoneCriteria, MilestoneProgress } from './milestone-criteria';
import { MilestoneReleases } from './milestone-releases';
import { useProject } from './project-context';

export function MilestonesPage() {
  const { project, readOnly } = useProject();
  const canManage = project.viewerCanManage && !readOnly;
  const milestones = useApiQuery<Milestone[]>(`/projects/${project.id}/milestones`);

  return (
    <div className="space-y-7">
      {canManage ? <CreateMilestone onCreated={milestones.reload} /> : null}
      {milestones.error ? <Alert>{milestones.error.message}</Alert> : null}
      {SECTIONS.map((section) => (
        <MilestoneSection
          key={section.stage}
          title={MILESTONE_STAGE_LABEL[section.stage]}
          items={milestones.data?.filter((m) => m.status === section.stage) ?? []}
          empty={section.empty}
          canManage={canManage}
          onChanged={milestones.reload}
        />
      ))}
    </div>
  );
}

/** 0025 §5: the work in flight first, then what's planned, then what's delivered. */
const SECTIONS: { stage: MilestoneStatus; empty: string }[] = [
  { stage: 'ACTIVE', empty: 'Nothing is being built right now.' },
  { stage: 'CLIENT_REVIEW', empty: 'Nothing is with the client for review.' },
  { stage: 'PLANNED', empty: 'No planned milestones.' },
  { stage: 'DELIVERED', empty: 'Delivered milestones will show up here.' },
];

const STAGE_TONE: Record<MilestoneStatus, 'neutral' | 'blue' | 'amber' | 'green'> = {
  PLANNED: 'neutral',
  ACTIVE: 'blue',
  CLIENT_REVIEW: 'amber',
  DELIVERED: 'green',
};

function MilestoneSection({
  title,
  items,
  empty,
  canManage,
  onChanged,
}: {
  title: string;
  items: Milestone[];
  empty: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-md font-semibold text-fg">
        {title} · {items.length}
      </h2>
      {items.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <MilestoneRow key={m.id} milestone={m} canManage={canManage} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MilestoneRow({
  milestone: m,
  canManage,
  onChanged,
}: {
  milestone: Milestone;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { project } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  const completed = m.status === 'DELIVERED';
  const ready = isReadyForReview(m);
  const readyKey = `devtrack:milestone-review-dismissed:${m.id}`;
  const readyFingerprint = `${m.status}:${m.taskCounts.total}:${m.taskCounts.done}:${m.criteria.map((c) => `${c.id}:${c.done}`).join(',')}`;
  const [, setDismissTick] = useState(0);
  useEffect(() => {
    if (ready) return;
    try {
      window.localStorage.removeItem(readyKey);
    } catch {
      // Ignore storage errors.
    }
  }, [ready, readyKey]);

  function dismissReadyBanner() {
    try {
      window.localStorage.setItem(readyKey, readyFingerprint);
    } catch {
      // Ignore storage errors.
    }
    setDismissTick((n) => n + 1);
  }

  let dismissedFor: string | null = null;
  if (typeof window !== 'undefined' && ready) {
    try {
      dismissedFor = window.localStorage.getItem(readyKey);
    } catch {
      dismissedFor = null;
    }
  }
  const showReadyBanner = canManage && ready && dismissedFor !== readyFingerprint;
  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
      <FlagIcon
        size={18}
        className={`mt-1 shrink-0 ${completed ? 'text-status-done' : 'text-fg-subtle'}`}
      />
      <div className="min-w-0 flex-1">
        {/* Name and actions share a row on wide cards; on phones the actions wrap below the name. */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
            <p className={`text-lg font-semibold ${completed ? 'text-fg-muted' : 'text-fg'}`}>
              {m.name}
            </p>
            {m.description ? <p className="mt-0.5 text-sm text-fg-muted">{m.description}</p> : null}
            {m.dueDate ? (
              <p className={`mt-1.5 text-xs ${dueTone(m.dueDate, completed)}`}>
                {dueLabel(m.dueDate, completed)}
              </p>
            ) : null}
          </div>
          {canManage ? (
            <div className="flex shrink-0 items-center gap-2">
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
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => call(() => api(`/milestones/${m.id}`, { method: 'DELETE' }))}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Badge tone={STAGE_TONE[m.status]}>{MILESTONE_STAGE_LABEL[m.status]}</Badge>
          )}
        </div>
        {error ? <p className="mt-1 text-sm text-danger">{error}</p> : null}
        {showReadyBanner ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm">
            <span className="font-medium text-fg">Everything is done. Move to Client review?</span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() =>
                  call(() =>
                    api(`/milestones/${m.id}`, {
                      method: 'PATCH',
                      body: { status: 'CLIENT_REVIEW' },
                    }),
                  )
                }
              >
                Move to Client review
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={dismissReadyBanner}>
                Not yet
              </Button>
            </div>
          </div>
        ) : null}
        <MilestoneProgress milestone={m} projectId={project.id} />
        <MilestoneCriteria milestone={m} canManage={canManage} onChanged={onChanged} />
        <MilestoneReleases milestone={m} canManage={canManage} onChanged={onChanged} />
      </div>
    </li>
  );
}

/** Calendar-date difference in days between a YYYY-MM-DD string and today (local). */
function daysUntil(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const target = Date.UTC(y!, m! - 1, d!);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

function dueTone(iso: string, completed: boolean) {
  if (completed) return 'text-fg-muted';
  const days = daysUntil(iso);
  if (days < 0) return 'font-medium text-danger';
  if (days <= 2) return 'font-medium text-warning-fg';
  return 'text-fg-muted';
}

function dueLabel(iso: string, completed: boolean) {
  if (!completed && daysUntil(iso) < 0) return `Overdue · ${formatDate(iso)}`;
  return `Due ${formatDate(iso)}`;
}

function CreateMilestone({ onCreated }: { onCreated: () => void }) {
  const { project } = useProject();
  // Phones start with a button so the milestones themselves are on the first screen.
  const [expanded, setExpanded] = useState(false);
  const form = useAuthForm(
    withoutBlanks(createMilestoneSchema),
    { name: '', description: '', dueDate: '' },
    async (values) => {
      await api(`/projects/${project.id}/milestones`, { body: values });
      setExpanded(false);
      onCreated();
    },
  );
  return (
    <>
      {expanded ? null : (
        <Button className="sm:hidden" onClick={() => setExpanded(true)}>
          <PlusIcon size={14} />
          New milestone
        </Button>
      )}
      <section
        aria-label="New milestone"
        className={`rounded-panel border border-line-control bg-surface p-5 shadow-raised sm:block ${expanded ? '' : 'hidden'}`}
      >
        <form
          onSubmit={form.onSubmit}
          noValidate
          className="grid gap-3 sm:grid-cols-milestone-form sm:items-end"
        >
          <Field
            label="Name"
            name="name"
            value={form.values.name}
            onChange={form.onChange}
            error={form.fieldErrors.name}
          />
          <Field
            label="Description"
            name="description"
            value={form.values.description}
            onChange={form.onChange}
            error={form.fieldErrors.description}
          />
          <Field
            label="Due date"
            name="dueDate"
            type="date"
            value={form.values.dueDate}
            onChange={form.onChange}
            error={form.fieldErrors.dueDate}
          />
          <div className="w-28">
            <SubmitButton pending={form.pending}>Add</SubmitButton>
          </div>
        </form>
        {form.formError ? (
          <div className="mt-3">
            <Alert>{form.formError}</Alert>
          </div>
        ) : null}
      </section>
    </>
  );
}

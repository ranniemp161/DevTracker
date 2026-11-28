'use client';

import type { Milestone, MilestoneStatus } from '@devtrack/types';
import { createMilestoneSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FlagIcon, PlusIcon } from '@/components/icons';
import { Alert, Badge, Button, EmptyState, Field, SubmitButton } from '@/components/ui';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useAuthForm, withoutBlanks } from '../auth/use-auth-form';
import {
  dueLabel,
  dueTone,
  isReadyForReview,
  MILESTONE_STAGE_LABEL,
  MILESTONE_STAGE_TONE,
} from './labels';
import { MilestoneProgress } from './milestone-criteria';
import { useProject } from './project-context';

export function MilestonesPage() {
  const { project, readOnly } = useProject();
  const canManage = project.viewerCanManage && !readOnly;
  const milestones = useApiQuery<Milestone[]>(`/projects/${project.id}/milestones`);

  return (
    <div className="space-y-7">
      {canManage ? <CreateMilestone /> : null}
      {milestones.error ? <Alert>{milestones.error.message}</Alert> : null}
      {SECTIONS.map((section) => (
        <MilestoneSection
          key={section.stage}
          title={MILESTONE_STAGE_LABEL[section.stage]}
          items={milestones.data?.filter((m) => m.status === section.stage) ?? []}
          empty={section.empty}
          canManage={canManage}
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

function MilestoneSection({
  title,
  items,
  empty,
  canManage,
}: {
  title: string;
  items: Milestone[];
  empty: string;
  canManage: boolean;
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
            <MilestoneRow key={m.id} milestone={m} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The first line of the Markdown brief, as plain text, for the summary. */
function excerpt(markdown: string | null) {
  const line = markdown
    ?.split('\n')
    .map((l) => l.replace(/^[#>*\-\s]+|[*_`]/g, '').trim())
    .find(Boolean);
  return line ?? null;
}

/** 0030 §3: a summary that opens the milestone's own page. */
function MilestoneRow({ milestone: m, canManage }: { milestone: Milestone; canManage: boolean }) {
  const { project } = useProject();
  const delivered = m.status === 'DELIVERED';
  const met = m.criteria.filter((c) => c.done).length;
  const summary = excerpt(m.description);
  return (
    <li className="relative flex items-start gap-3 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-control">
      <FlagIcon
        size={18}
        className={`mt-1 shrink-0 ${delivered ? 'text-status-done' : 'text-fg-subtle'}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
            {/* The whole card opens the milestone; "View tasks" below sits above the link. */}
            <Link
              href={`/projects/${project.id}/milestones/${m.id}`}
              className={`text-lg font-semibold after:absolute after:inset-0 after:rounded-card hover:underline ${delivered ? 'text-fg-muted' : 'text-fg'}`}
            >
              {m.name}
            </Link>
            {summary ? <p className="mt-0.5 truncate text-sm text-fg-muted">{summary}</p> : null}
            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
              {m.dueDate ? (
                <span className={dueTone(m.dueDate, delivered)}>
                  {dueLabel(m.dueDate, delivered)}
                </span>
              ) : null}
              {m.criteria.length > 0 ? (
                <span>
                  {met} of {m.criteria.length} criteria met
                </span>
              ) : null}
              {m.clientApproval ? (
                <span className="text-status-done-fg">Approved by the client</span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canManage && isReadyForReview(m) ? (
              <Badge tone="green">Ready for client review</Badge>
            ) : null}
            <Badge tone={MILESTONE_STAGE_TONE[m.status]}>{MILESTONE_STAGE_LABEL[m.status]}</Badge>
          </div>
        </div>
        <div className="relative">
          <MilestoneProgress milestone={m} projectId={project.id} />
        </div>
      </div>
    </li>
  );
}

function CreateMilestone() {
  const { project } = useProject();
  const router = useRouter();
  // Phones start with a button so the milestones themselves are on the first screen.
  const [expanded, setExpanded] = useState(false);
  const form = useAuthForm(
    withoutBlanks(createMilestoneSchema),
    { name: '', description: '', dueDate: '' },
    async (values) => {
      // 0030 §3: a new milestone opens on its own page, to write the brief.
      const { milestone } = await api<{ milestone: Milestone }>(
        `/projects/${project.id}/milestones`,
        { body: values },
      );
      router.push(`/projects/${project.id}/milestones/${milestone.id}`);
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

'use client';

import type { Milestone } from '@devtrack/types';
import Link from 'next/link';
import { CheckIcon, ChevronRightIcon, FlagIcon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { dueLabel, dueTone, excerpt, MILESTONE_STAGE_LABEL, MILESTONE_STAGE_TONE } from './labels';

/**
 * 0030 §4: the delivery a task belongs to, so whoever picks it up sees the goal. Name (linking
 * to the brief), stage, due date, the opening of the description, and the acceptance criteria
 * (read-only). The task's own checklist below is how they do their part.
 */
export function TaskMilestoneCard({
  milestone: m,
  projectId,
}: {
  milestone: Milestone;
  projectId: string;
}) {
  const delivered = m.status === 'DELIVERED';
  const met = m.criteria.filter((c) => c.done).length;
  const summary = excerpt(m.description, 3);
  const href = `/projects/${projectId}/milestones/${m.id}`;

  return (
    <section
      aria-label={`Milestone: ${m.name}`}
      className="rounded-card border border-line bg-surface-sunken p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 items-start gap-2.5">
          <FlagIcon size={16} className="mt-0.5 shrink-0 text-fg-subtle" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg-muted">Part of</p>
            <Link href={href} className="font-semibold text-fg hover:underline">
              {m.name}
            </Link>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Badge tone={MILESTONE_STAGE_TONE[m.status]}>{MILESTONE_STAGE_LABEL[m.status]}</Badge>
              {m.dueDate ? (
                <span className={dueTone(m.dueDate, delivered)}>
                  {dueLabel(m.dueDate, delivered)}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-label font-medium text-fg-secondary hover:text-fg"
        >
          Open brief
          <ChevronRightIcon size={14} />
        </Link>
      </div>

      {summary ? <p className="mt-3 line-clamp-3 text-sm text-fg-secondary">{summary}</p> : null}

      {m.criteria.length > 0 ? (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-label font-medium text-fg-secondary pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              size={14}
              className="text-fg-muted transition-transform group-open:rotate-90"
            />
            Acceptance criteria
            <span className="font-normal text-fg-muted">
              · {met} of {m.criteria.length} met
            </span>
          </summary>
          <ul className="mt-2 space-y-1.5 pl-5">
            {m.criteria.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <span
                  aria-hidden
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-control border ${c.done ? 'border-status-done bg-status-done text-surface' : 'border-line-control'}`}
                >
                  {c.done ? <CheckIcon size={12} /> : null}
                </span>
                <span className={c.done ? 'text-fg-muted line-through' : 'text-fg'}>
                  <span className="sr-only">{c.done ? 'Met: ' : 'Not met yet: '}</span>
                  {c.text}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

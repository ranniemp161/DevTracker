'use client';

import type { Milestone } from '@devtrack/types';
import { FlagIcon } from '@/components/icons';
import { useApiQuery } from '@/lib/use-api-query';

/**
 * A small milestone tag showing which delivery a task belongs to (0031 §3 #4, #5).
 * Displays a flag icon and the milestone name, truncated.
 *
 * @param props Component properties.
 * @param props.projectId Project ID that the milestone belongs to.
 * @param props.milestoneId Milestone ID associated with the task, if any.
 * @param props.milestones Optional preloaded milestones list to avoid extra query.
 * @param props.className Optional additional CSS classes.
 * @returns Milestone tag badge or null if no milestone is set / found.
 */
export function TaskMilestoneTag({
  projectId,
  milestoneId,
  milestones,
  className,
}: {
  projectId: string;
  milestoneId: string | null;
  milestones?: Milestone[];
  className?: string;
}) {
  const query = useApiQuery<Milestone[]>(
    milestoneId && !milestones ? `/projects/${projectId}/milestones` : null,
  );
  if (!milestoneId) return null;

  const list = milestones ?? query.data;
  if (!list) return null;

  const milestone = list.find((m) => m.id === milestoneId);
  if (!milestone) return null;

  return (
    <span
      title={`Milestone: ${milestone.name}`}
      className={`inline-flex max-w-28 items-center gap-1 rounded-chip border border-line bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-fg-muted whitespace-nowrap sm:max-w-36 ${className ?? ''}`}
    >
      <FlagIcon size={12} className="shrink-0 text-fg-subtle" />
      <span className="truncate">{milestone.name}</span>
    </span>
  );
}

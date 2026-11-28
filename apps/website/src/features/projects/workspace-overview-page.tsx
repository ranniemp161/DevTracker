'use client';

import type { Milestone, WorkspaceOverview } from '@devtrack/types';
import Link from 'next/link';
import { TagIcon } from '@/components/icons';
import { Alert, Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { useWorkspace } from '../workspaces/workspace-context';
import { formatDate, isReadyForReview, MILESTONE_STAGE_LABEL } from './labels';

/**
 * Every delivery in flight across the workspace (decision record 0027). Read only, real numbers
 * only: changes happen on each project's Milestones page.
 */
export function WorkspaceOverviewPage() {
  const { workspace } = useWorkspace();
  const query = useApiQuery<WorkspaceOverview>(
    workspace.viewerCanSeeOverview ? `/workspaces/${workspace.id}/overview` : null,
  );

  if (!workspace.viewerCanSeeOverview) {
    return <Alert tone="info">The overview is for workspace admins and project leads.</Alert>;
  }
  if (query.error) return <ErrorState message={query.error.message} onRetry={query.reload} />;
  if (!query.data) {
    return (
      <div role="status" aria-label="Loading overview" className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (query.data.sections.length === 0) {
    return (
      <EmptyState>
        No milestones in flight. Planned, Active and Client review milestones show up here.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      {query.data.sections.map((section) => (
        <section key={section.stage} aria-label={MILESTONE_STAGE_LABEL[section.stage]}>
          <h2 className="mb-3 text-md font-semibold text-fg">
            {MILESTONE_STAGE_LABEL[section.stage]} ·{' '}
            {section.projects.reduce((n, g) => n + g.milestones.length, 0)}
          </h2>
          <div className="space-y-4">
            {section.projects.map(({ project, milestones }) => (
              <div key={project.id} className="space-y-2">
                <Link
                  href={`/projects/${project.id}`}
                  className="text-label font-medium text-fg-secondary hover:text-fg hover:underline"
                >
                  <span className="font-mono">{project.key}</span> · {project.name}
                </Link>
                <ul className="space-y-2">
                  {milestones.map((m) => (
                    <OverviewRow key={m.id} milestone={m} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function OverviewRow({ milestone: m }: { milestone: Milestone }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = m.dueDate !== null && m.dueDate < today;
  const { total, done, addedAfterStart } = m.taskCounts;
  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <Link
          href={`/projects/${m.projectId}/milestones/${m.id}`}
          className="min-w-0 flex-1 basis-48 text-md font-semibold text-fg hover:underline"
        >
          {m.name}
        </Link>
        <span className="flex flex-wrap items-center gap-2">
          {isReadyForReview(m) ? <Badge tone="green">Ready for client review</Badge> : null}
          {overdue ? <Badge tone="red">Overdue</Badge> : null}
        </span>
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
        {m.dueDate ? (
          <span className={overdue ? 'font-medium text-danger' : ''}>
            Due {formatDate(m.dueDate)}
          </span>
        ) : (
          <span>No due date</span>
        )}
        <span>{total === 0 ? 'No tasks yet' : `${done} of ${total} tasks done`}</span>
        {m.startedAt && addedAfterStart > 0 ? (
          <span className="font-medium text-warning-fg">{addedAfterStart} added after start</span>
        ) : null}
        {m.criteria.length > 0 ? (
          <span>
            {m.criteria.filter((c) => c.done).length} of {m.criteria.length} criteria met
          </span>
        ) : null}
      </p>
      {m.releases.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {m.releases.map((r) => (
            <li key={r.id}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg hover:underline"
              >
                <TagIcon size={12} />
                {r.tagName} · {r.repository}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

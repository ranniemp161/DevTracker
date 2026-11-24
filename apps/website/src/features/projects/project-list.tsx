'use client';

import type { Project, ProjectChatUnreadSummary } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarIcon, PlusIcon, UsersIcon } from '@/components/icons';
import { HeaderActions } from '@/components/page-header';
import { avatarTone, Badge, ErrorState, Skeleton } from '@/components/ui';
import { usePageVisible } from '@/lib/page-visibility';
import { useApiQuery } from '@/lib/use-api-query';
import { isAdmin } from '../workspaces/permissions';
import { useWorkspace } from '../workspaces/workspace-context';
import { formatDate, PROJECT_STATUS_LABEL, projectStatusTone } from './labels';

/** Workspace "All projects": admins see all projects, members see theirs (M3 rule 1). */
export function ProjectList() {
  const { workspace } = useWorkspace();
  const [showArchived, setShowArchived] = useState(false);
  const projects = useApiQuery<Project[]>(
    `/workspaces/${workspace.id}/projects${showArchived ? '?includeArchived=true' : ''}`,
  );
  const unreadQuery = useApiQuery<ProjectChatUnreadSummary[]>(
    `/workspaces/${workspace.id}/chat/unread`,
  );
  const canCreate = isAdmin(workspace.role);
  const newProjectHref = `/workspaces/${workspace.id}/projects/new`;

  const reloadUnread = unreadQuery.reload;
  const visible = usePageVisible();

  // Poll only while the tab is visible; returning to the tab fires `focus`, which catches up.
  useEffect(() => {
    window.addEventListener('focus', reloadUnread);
    if (!visible) return () => window.removeEventListener('focus', reloadUnread);
    const interval = setInterval(reloadUnread, 30_000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', reloadUnread);
    };
  }, [reloadUnread, visible]);

  return (
    <div className="space-y-4">
      <HeaderActions>
        <label className="flex min-h-9 items-center gap-2 text-sm text-fg-secondary pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {canCreate ? (
          <Link
            href={newProjectHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-control bg-primary px-3.5 text-sm font-medium text-fg-on-inverse transition-colors hover:bg-primary-hover pointer-coarse:h-11"
          >
            <PlusIcon size={15} />
            New project
          </Link>
        ) : null}
      </HeaderActions>

      {projects.error ? (
        <ErrorState message={projects.error.message} onRetry={projects.reload} />
      ) : null}

      {!projects.data && !projects.error ? (
        <ul role="status" aria-label="Loading projects" className="grid grid-cols-cards gap-4">
          {[0, 1, 2].map((i) => (
            <li key={i} className="space-y-3 rounded-panel border border-line bg-surface p-5">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-32" />
            </li>
          ))}
        </ul>
      ) : null}

      {projects.data && projects.data.length === 0 && !canCreate ? (
        <div className="rounded-panel border border-dashed border-line-control bg-surface p-10 text-center text-sm text-fg-muted">
          You have not been added to any projects yet. Ask a workspace admin.
        </div>
      ) : null}

      {projects.data && (projects.data.length > 0 || canCreate) ? (
        <ul className="grid grid-cols-cards gap-4">
          {projects.data.map((p) => (
            <li key={p.id}>
              <ProjectCard
                project={p}
                unread={unreadQuery.data?.find((u) => u.projectId === p.id)?.unreadCount ?? 0}
              />
            </li>
          ))}
          {canCreate ? (
            <li>
              <Link
                href={newProjectHref}
                className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line-dashed p-5 text-center transition-colors hover:border-line-control hover:bg-surface-sunken"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-card bg-primary-soft text-primary-soft-fg"
                >
                  <PlusIcon size={18} />
                </span>
                <span className="text-sm font-medium text-fg">Start a new project</span>
                <span className="text-label text-fg-muted">
                  {projects.data.length === 0
                    ? 'No projects yet. Create one to start tracking tasks.'
                    : 'A board, milestones and chat for your team.'}
                </span>
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Real progress from the project's live tasks (SPEC R3, lifted once the API had counts). */
function ProjectProgress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{total === 0 ? 'No tasks yet' : `${done} of ${total} tasks done`}</span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Tasks done"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full rounded-full bg-status-done" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ProjectCard({ project: p, unread }: { project: Project; unread: number }) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className="flex h-full flex-col gap-3 rounded-panel border border-line bg-surface p-5 transition-colors hover:border-line-control"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex size-9 shrink-0 items-center justify-center rounded-card text-sm font-semibold uppercase ${avatarTone(p.id)}`}
        >
          {p.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-semibold text-fg" title={p.name}>
            {p.name}
          </p>
          <p className="font-mono text-xs text-fg-muted">{p.key}</p>
        </div>
        <Badge tone={projectStatusTone(p.status)}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
      </div>
      {p.description ? <p className="line-clamp-2 text-sm text-fg-muted">{p.description}</p> : null}
      {/* Absent only while an older API is still deployed. */}
      {p.taskCounts ? (
        <ProjectProgress done={p.taskCounts.done} total={p.taskCounts.total} />
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle pt-3 text-label text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <UsersIcon size={14} />
          {p.memberCount} {p.memberCount === 1 ? 'member' : 'members'}
        </span>
        {p.targetDate ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon size={14} />
            Target {formatDate(p.targetDate)}
          </span>
        ) : null}
        {unread > 0 ? (
          <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-fg-on-inverse">
            {unread} unread
          </span>
        ) : null}
      </div>
    </Link>
  );
}

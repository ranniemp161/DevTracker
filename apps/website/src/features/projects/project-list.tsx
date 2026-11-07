'use client';

import type { Project, ProjectChatUnreadSummary } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { isAdmin } from '../workspaces/permissions';
import { useWorkspace } from '../workspaces/workspace-context';
import { formatDate, PROJECT_STATUS_LABEL } from './labels';

/** Workspace "Projects" tab: admins see all projects, members see theirs (M3 rule 1). */
export function ProjectList() {
  const { workspace } = useWorkspace();
  const [showArchived, setShowArchived] = useState(false);
  const projects = useApiQuery<Project[]>(
    `/workspaces/${workspace.id}/projects${showArchived ? '?includeArchived=true' : ''}`,
  );
  const unreadQuery = useApiQuery<ProjectChatUnreadSummary[]>(
    `/workspaces/${workspace.id}/chat/unread`,
  );

  useEffect(() => {
    const interval = setInterval(() => {
      unreadQuery.reload();
    }, 30_000);
    const onFocus = () => unreadQuery.reload();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [unreadQuery]);

  const canCreate = isAdmin(workspace.role);

  return (
    <div className="space-y-5">
      {/* Action and filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-xs font-medium text-mineral cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-3.5 rounded border-border text-accent focus:ring-accent/20 cursor-pointer"
          />
          Show archived projects
        </label>
        {canCreate ? (
          <Link
            href={`/workspaces/${workspace.id}/projects/new`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
          >
            <span>+</span>
            <span>New project</span>
          </Link>
        ) : null}
      </div>

      {projects.error ? (
        <ErrorState message={projects.error.message} onRetry={projects.reload} />
      ) : null}

      {!projects.data && !projects.error ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ) : null}

      {projects.data && projects.data.length === 0 ? (
        <EmptyState
          title={canCreate ? 'No projects yet' : 'No accessible projects'}
          description={
            canCreate
              ? 'Create a project to start planning milestones, tracking tasks, and collaborating.'
              : 'You have not been added to any projects in this workspace yet. Ask an admin to add you.'
          }
          action={
            canCreate ? (
              <Link
                href={`/workspaces/${workspace.id}/projects/new`}
                className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover"
              >
                Create your first project
              </Link>
            ) : null
          }
        />
      ) : null}

      {projects.data && projects.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.data.map((p) => {
            const unread = unreadQuery.data?.find((u) => u.projectId === p.id)?.unreadCount ?? 0;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="group block rounded-xl border border-border bg-surface p-5 shadow-xs transition-all duration-150 hover:border-border-strong hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-semibold tracking-wider text-mineral bg-subtle px-1.5 py-0.5 rounded border border-border">
                        {p.key}
                      </span>
                      <h3 className="mt-1.5 truncate text-base font-semibold text-graphite group-hover:text-accent-text transition-colors">
                        {p.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {unread > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-tint px-2 py-0.5 text-xs font-semibold text-accent-text">
                          <span className="size-1.5 rounded-full bg-accent" />
                          {unread} unread
                        </span>
                      ) : null}
                      <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>
                        {PROJECT_STATUS_LABEL[p.status]}
                      </Badge>
                    </div>
                  </div>

                  {p.description ? (
                    <p className="mt-2.5 line-clamp-2 text-xs text-mineral leading-relaxed">
                      {p.description}
                    </p>
                  ) : null}

                  <div className="mt-4 flex items-center gap-2 text-xs text-mineral-muted border-t border-border/50 pt-2.5">
                    <span>
                      {p.memberCount} {p.memberCount === 1 ? 'member' : 'members'}
                    </span>
                    {p.targetDate ? (
                      <>
                        <span>·</span>
                        <span>Target {formatDate(p.targetDate)}</span>
                      </>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

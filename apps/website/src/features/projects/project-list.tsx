'use client';

import type { Project, ProjectChatUnreadSummary } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge } from '@/components/ui';
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {isAdmin(workspace.role) ? (
          <Link
            href={`/workspaces/${workspace.id}/projects/new`}
            className="inline-flex h-9 items-center rounded-control bg-primary px-3.5 text-sm font-medium text-fg-on-inverse transition-colors hover:bg-primary-hover"
          >
            New project
          </Link>
        ) : null}
      </div>

      {projects.error ? <Alert>{projects.error.message}</Alert> : null}
      {projects.data && projects.data.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line-control bg-surface p-10 text-center text-sm text-fg-muted">
          {isAdmin(workspace.role)
            ? 'No projects yet. Create one to start tracking tasks.'
            : 'You have not been added to any projects yet. Ask a workspace admin.'}
        </div>
      ) : null}

      <ul className="grid grid-cols-cards gap-4">
        {projects.data?.map((p) => {
          const unread = unreadQuery.data?.find((u) => u.projectId === p.id)?.unreadCount ?? 0;
          return (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-panel border border-line bg-surface p-5 transition-colors hover:border-line-control"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-fg">{p.name}</p>
                    <p className="font-mono text-xs text-fg-subtle">{p.key}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {unread > 0 ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-fg-on-inverse">
                        {unread} unread
                      </span>
                    ) : null}
                    <Badge
                      tone={
                        p.status === 'ACTIVE' || p.status === 'PLANNING'
                          ? 'blue'
                          : p.status === 'COMPLETED'
                            ? 'green'
                            : 'neutral'
                      }
                    >
                      {PROJECT_STATUS_LABEL[p.status]}
                    </Badge>
                  </div>
                </div>
                {p.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-fg-muted">{p.description}</p>
                ) : null}
                <p className="mt-3 text-xs text-fg-subtle">
                  {p.memberCount} {p.memberCount === 1 ? 'member' : 'members'}
                  {p.targetDate ? ` · target ${formatDate(p.targetDate)}` : ''}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

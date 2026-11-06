'use client';

import type { Project } from '@devtrack/types';
import Link from 'next/link';
import { useState } from 'react';
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm text-neutral-600">
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
            className="rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            New project
          </Link>
        ) : null}
      </div>

      {projects.error ? <Alert>{projects.error.message}</Alert> : null}
      {projects.data && projects.data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-600">
          {isAdmin(workspace.role)
            ? 'No projects yet. Create one to start tracking tasks.'
            : 'You have not been added to any projects yet. Ask a workspace admin.'}
        </div>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {projects.data?.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              className="block rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-neutral-500">{p.key}</p>
                  <p className="truncate font-medium">{p.name}</p>
                </div>
                <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>
                  {PROJECT_STATUS_LABEL[p.status]}
                </Badge>
              </div>
              {p.description ? (
                <p className="mt-2 line-clamp-2 text-sm text-neutral-600">{p.description}</p>
              ) : null}
              <p className="mt-3 text-xs text-neutral-500">
                {p.memberCount} {p.memberCount === 1 ? 'member' : 'members'}
                {p.targetDate ? ` · target ${formatDate(p.targetDate)}` : ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

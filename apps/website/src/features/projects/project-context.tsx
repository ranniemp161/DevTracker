'use client';

import type { Project, ProjectMember } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { Alert, Badge } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { PROJECT_STATUS_LABEL } from './labels';

interface ProjectContextValue {
  project: Project;
  members: ProjectMember[];
  /** Archived projects are read-only (M3 rule 3). */
  readOnly: boolean;
  reload: () => void;
  reloadMembers: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useProject must be used inside ProjectLayout');
  return value;
}

export function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const project = useApiQuery<{ project: Project }>(`/projects/${id}`);
  const members = useApiQuery<ProjectMember[]>(`/projects/${id}/members`);

  if (project.error) {
    return (
      <div className="space-y-4">
        <Alert>
          {project.error.status === 404
            ? 'This project does not exist or you do not have access to it.'
            : project.error.message}
        </Alert>
        <Link href="/" className="text-sm underline">
          Back to workspaces
        </Link>
      </div>
    );
  }
  if (!project.data || !members.data)
    return <p className="text-sm text-neutral-500">Loading project…</p>;

  const p = project.data.project;
  const base = `/projects/${p.id}`;
  const tabs = [
    { href: base, label: 'Board' },
    { href: `${base}/list`, label: 'List' },
    { href: `${base}/milestones`, label: 'Milestones' },
    { href: `${base}/members`, label: 'Members' },
    ...(p.viewerCanManage ? [{ href: `${base}/settings`, label: 'Settings' }] : []),
  ];
  const readOnly = p.status === 'ARCHIVED';

  return (
    <ProjectContext.Provider
      value={{
        project: p,
        members: members.data,
        readOnly,
        reload: project.reload,
        reloadMembers: members.reload,
      }}
    >
      <div className="space-y-6">
        <div>
          <Link
            href={`/workspaces/${p.workspaceId}/projects`}
            className="text-sm text-neutral-600 hover:underline"
          >
            ← Projects
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs font-semibold tracking-wide">
              {p.key}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
            <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>
              {PROJECT_STATUS_LABEL[p.status]}
            </Badge>
          </div>
          {readOnly ? (
            <div className="mt-3">
              <Alert tone="info">This project is archived and read-only.</Alert>
            </div>
          ) : null}
          <nav className="mt-4 flex gap-1 border-b border-neutral-200" aria-label="Project">
            {tabs.map((tab) => {
              const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                    active
                      ? 'border-neutral-900 font-medium text-neutral-900'
                      : 'border-transparent text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {children}
      </div>
    </ProjectContext.Provider>
  );
}

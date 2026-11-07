'use client';

import type { Project, ProjectMember } from '@devtrack/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { Alert, Badge, KeyBadge } from '@/components/ui';
import { useRealtimeRefresh, useRealtimeRoom, type RealtimeEvent } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useShellData } from '../session/shell-data';
import { PROJECT_STATUS_LABEL } from './labels';

interface ProjectContextValue {
  project: Project;
  members: ProjectMember[];
  /** Archived projects are read-only (M3 rule 3). */
  readOnly: boolean;
  reload: () => void;
  reloadMembers: () => void;
  reloadChatUnread: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error('useProject must be used inside ProjectLayout');
  return value;
}

export function ProjectLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const project = useApiQuery<{ project: Project }>(`/projects/${id}`);
  const members = useApiQuery<ProjectMember[]>(`/projects/${id}/members`);
  const { reloadChatUnread } = useShellData();

  // Every page of a project follows the project room (M7); individual views react to events.
  useRealtimeRoom(`project:${id}`);
  useRealtimeRefresh(
    (e) => e.projectId === id && e.type === 'activity.created' && isProjectChange(e),
    () => {
      project.reload();
      members.reload();
    },
  );

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
    return <p className="text-sm text-fg-subtle">Loading project…</p>;

  const p = project.data.project;
  const readOnly = p.status === 'ARCHIVED';

  return (
    <ProjectContext.Provider
      value={{
        project: p,
        members: members.data,
        readOnly,
        reload: project.reload,
        reloadMembers: members.reload,
        reloadChatUnread,
      }}
    >
      <div className="space-y-6">
        <div>
          <Link
            href={`/workspaces/${p.workspaceId}/projects`}
            className="text-label text-fg-muted hover:underline"
          >
            ← Projects
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <KeyBadge>{p.key}</KeyBadge>
            <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
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
          {readOnly ? (
            <div className="mt-3">
              <Alert tone="info">This project is archived and read-only.</Alert>
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </ProjectContext.Provider>
  );
}

/** Project-level changes (details, archive, membership) that the header and tabs show. */
function isProjectChange(e: RealtimeEvent): boolean {
  const action = (e.payload as { action?: string }).action ?? '';
  return action.startsWith('project.');
}

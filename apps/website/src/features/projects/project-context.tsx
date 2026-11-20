'use client';

import type { Project, ProjectMember } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert, Badge, KeyBadge, Skeleton } from '@/components/ui';
import { useRealtimeRefresh, useRealtimeRoom, type RealtimeEvent } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useSession } from '../session/session-context';
import { useShellData } from '../session/shell-data';
import { PROJECT_STATUS_LABEL, projectStatusTone } from './labels';

interface ProjectContextValue {
  project: Project;
  members: ProjectMember[];
  /** Archived projects are read-only (M3 rule 3). */
  readOnly: boolean;
  reload: () => void;
  reloadMembers: () => void;
  reloadChatUnread: () => void;
}

/** View names by the path after `/projects/[id]`, shown as the title on small screens. */
const VIEW_LABEL: Record<string, string> = {
  '': 'Board',
  '/list': 'List',
  '/chat': 'Chat',
  '/milestones': 'Milestones',
  '/timesheet': 'Timesheet',
  '/activity': 'Activity',
  '/settings': 'Settings',
  '/members': 'Members',
};

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
  const { reloadChatUnread } = useShellData();
  const { workspaces } = useSession();

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
  if (!project.data || !members.data) {
    return (
      <div
        role="status"
        aria-label="Loading project"
        className="space-y-3 border-b border-line pb-4"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-64" />
      </div>
    );
  }

  const p = project.data.project;
  const readOnly = p.status === 'ARCHIVED';
  // The task page has its own header bar and runs edge to edge.
  const isTaskPage = pathname.includes('/tasks/');
  const isChatPage = pathname.endsWith('/chat');
  const view = VIEW_LABEL[pathname.slice(`/projects/${p.id}`.length)] ?? p.name;
  const workspace = workspaces.find((w) => w.id === p.workspaceId);
  const workspaceHref = `/workspaces/${p.workspaceId}`;

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
      <div
        className={isChatPage ? 'flex min-h-0 flex-1 flex-col lg:block lg:space-y-6' : 'space-y-6'}
      >
        {isTaskPage ? (
          children
        ) : (
          <PageHeader
            // The mobile chat fills the screen; the top bar names the project.
            className={isChatPage ? 'max-lg:hidden' : ''}
            breadcrumb={[
              ...(workspace
                ? [{ label: workspace.name, href: workspaceHref, className: 'max-lg:hidden' }]
                : []),
              { label: 'Projects', href: workspaceHref, separatorClassName: 'max-lg:hidden' },
              { label: p.name, className: 'lg:hidden' },
            ]}
            // Phones already show the project name in the top bar, so the title names the view.
            title={
              <>
                <span className="lg:hidden">{view}</span>
                <span className="max-lg:hidden">{p.name}</span>
              </>
            }
            meta={
              <>
                <KeyBadge>{p.key}</KeyBadge>
                <Badge tone={projectStatusTone(p.status)}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
              </>
            }
          >
            {readOnly ? <Alert tone="info">This project is archived and read-only.</Alert> : null}
            {children}
          </PageHeader>
        )}
      </div>
    </ProjectContext.Provider>
  );
}

/** Project-level changes (details, archive, membership) that the header and tabs show. */
function isProjectChange(e: RealtimeEvent): boolean {
  const action = (e.payload as { action?: string }).action ?? '';
  return action.startsWith('project.');
}

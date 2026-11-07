'use client';

import type { Project, ProjectMember, ProjectChatUnreadSummary } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, Suspense, type ReactNode } from 'react';
import { Alert, Badge, ErrorState, Skeleton } from '@/components/ui';
import { useRealtimeRefresh, useRealtimeRoom, type RealtimeEvent } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
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
  const pathname = usePathname();
  const project = useApiQuery<{ project: Project }>(`/projects/${id}`);
  const members = useApiQuery<ProjectMember[]>(`/projects/${id}/members`);
  const workspaceId = project.data?.project.workspaceId;
  const chatUnread = useApiQuery<ProjectChatUnreadSummary[]>(
    workspaceId ? `/workspaces/${workspaceId}/chat/unread` : null,
  );

  // Every page of a project follows the project room (M7); individual views react to events.
  useRealtimeRoom(`project:${id}`);
  useRealtimeRefresh(
    (e) =>
      (e.projectId === id && e.type === 'activity.created' && isProjectChange(e)) ||
      e.type.startsWith('chat.'),
    () => {
      project.reload();
      members.reload();
      chatUnread.reload();
    },
  );

  if (project.error) {
    return (
      <div className="space-y-4 max-w-xl mx-auto py-8">
        <ErrorState
          message={
            project.error.status === 404
              ? 'This project does not exist or you do not have access to it.'
              : project.error.message
          }
          onRetry={project.reload}
        />
        <div className="text-center">
          <Link
            href="/"
            className="text-xs font-medium text-accent hover:underline hover:text-accent-hover"
          >
            ← Back to workspaces
          </Link>
        </div>
      </div>
    );
  }

  if (!project.data || !members.data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-16 rounded" />
            <Skeleton className="h-8 w-64 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-full rounded-lg mt-4" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  const p = project.data.project;
  const base = `/projects/${p.id}`;
  const unreadCount = chatUnread.data?.find((u) => u.projectId === p.id)?.unreadCount ?? 0;
  const tabs = [
    { href: base, label: 'Board' },
    { href: `${base}/list`, label: 'List' },
    { href: `${base}/chat`, label: 'Chat', count: unreadCount },
    { href: `${base}/milestones`, label: 'Milestones' },
    { href: `${base}/activity`, label: 'Activity' },
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
        reloadChatUnread: chatUnread.reload,
      }}
    >
      <div className="space-y-6">
        <div>
          <nav aria-label="Breadcrumb" className="mb-2">
            <Link
              href={`/workspaces/${p.workspaceId}/projects`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-mineral hover:text-graphite transition-colors"
            >
              <svg aria-hidden="true" className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                  clipRule="evenodd"
                />
              </svg>
              Projects
            </Link>
          </nav>

          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <span className="font-mono text-xs font-semibold tracking-wider text-mineral bg-subtle px-2 py-0.5 rounded-md border border-border">
              {p.key}
            </span>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold tracking-tight text-graphite">
              {p.name}
            </h1>
            <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>
              {PROJECT_STATUS_LABEL[p.status]}
            </Badge>
          </div>

          {readOnly ? (
            <div className="mt-3">
              <Alert tone="info">This project is archived and read-only.</Alert>
            </div>
          ) : null}

          <Suspense fallback={null}>
            <ProjectTabs tabs={tabs} base={base} pathname={pathname} />
          </Suspense>
        </div>

        {children}
      </div>
    </ProjectContext.Provider>
  );
}

function ProjectTabs({
  tabs,
  base,
  pathname,
}: {
  tabs: { href: string; label: string; count?: number }[];
  base: string;
  pathname: string;
}) {
  const searchParams = useSearchParams();
  const searchStr = searchParams.toString();

  return (
    <nav
      className="mt-5 flex gap-1 overflow-x-auto border-b border-border custom-scrollbar pb-px"
      aria-label="Project views and navigation"
    >
      {tabs.map((tab) => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        const targetHref =
          (tab.label === 'Board' || tab.label === 'List') && searchStr
            ? `${tab.href}?${searchStr}`
            : tab.href;

        return (
          <Link
            key={tab.href}
            href={targetHref}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium transition-colors ${
              active
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-mineral hover:border-border hover:text-graphite'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.2 text-[10px] font-bold text-white leading-none">
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Project-level changes (details, archive, membership) that the header and tabs show. */
function isProjectChange(e: RealtimeEvent): boolean {
  const action = (e.payload as { action?: string }).action ?? '';
  return action.startsWith('project.');
}

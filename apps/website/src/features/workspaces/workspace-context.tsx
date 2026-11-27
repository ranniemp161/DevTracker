'use client';

import type { WorkspaceDetails } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { Badge, ErrorState, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { ROLE_LABEL } from './permissions';

interface WorkspaceContextValue {
  workspace: WorkspaceDetails;
  reload: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceLayout');
  return value;
}

/** Page titles for the workspace routes, by the path after `/workspaces/[id]`. */
const PAGE_TITLE: Record<string, string> = {
  '': 'All projects',
  '/projects': 'All projects',
  '/projects/new': 'New project',
  '/members': 'Members',
  '/overview': 'Overview',
  '/my-tasks': 'My tasks',
  '/settings': 'Workspace settings',
};

/** Loads the workspace from the URL and renders the page header. */
export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const query = useApiQuery<{ workspace: WorkspaceDetails }>(`/workspaces/${id}`);

  if (query.error) {
    return (
      <div className="space-y-4">
        <ErrorState
          message={
            query.error.status === 404
              ? 'This workspace does not exist, was archived, or you are not a member.'
              : query.error.message
          }
          onRetry={query.reload}
        />
        <Link href="/" className="text-sm underline">
          Back to workspaces
        </Link>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div
        role="status"
        aria-label="Loading workspace"
        className="space-y-3 border-b border-line pb-4"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-56" />
      </div>
    );
  }

  const { workspace } = query.data;
  const subPath = pathname.slice(`/workspaces/${workspace.id}`.length);

  return (
    <WorkspaceContext.Provider value={{ workspace, reload: query.reload }}>
      <div className="space-y-6">
        <PageHeader
          breadcrumb={[
            {
              label: (
                <span className="flex items-center gap-2">
                  {workspace.name}
                  <Badge tone={workspace.role === 'OWNER' ? 'green' : 'neutral'}>
                    {ROLE_LABEL[workspace.role]}
                  </Badge>
                </span>
              ),
            },
            ...(subPath === '/projects/new'
              ? [{ label: 'All projects', href: `/workspaces/${workspace.id}` }]
              : []),
          ]}
          title={PAGE_TITLE[subPath] ?? workspace.name}
        >
          {children}
        </PageHeader>
      </div>
    </WorkspaceContext.Provider>
  );
}

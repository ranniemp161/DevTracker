'use client';

import type { WorkspaceDetails } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { Badge, ErrorState, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { isAdmin, ROLE_LABEL } from './permissions';

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

/** Loads the workspace from the URL and renders its header and tabs. */
export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const query = useApiQuery<{ workspace: WorkspaceDetails }>(`/workspaces/${id}`);

  if (query.error) {
    return (
      <div className="space-y-4 max-w-xl mx-auto py-8">
        <ErrorState
          message={
            query.error.status === 404
              ? 'This workspace does not exist, was archived, or you are not a member.'
              : query.error.message
          }
          onRetry={query.reload}
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

  if (!query.data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg mt-4" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  const { workspace } = query.data;
  const base = `/workspaces/${workspace.id}`;
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/projects`, label: 'Projects' },
    { href: `${base}/members`, label: 'Members' },
    ...(isAdmin(workspace.role) ? [{ href: `${base}/settings`, label: 'Settings' }] : []),
  ];

  return (
    <WorkspaceContext.Provider value={{ workspace, reload: query.reload }}>
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-graphite">
              {workspace.name}
            </h1>
            <Badge tone={workspace.role === 'OWNER' ? 'teal' : 'neutral'}>
              {ROLE_LABEL[workspace.role]}
            </Badge>
          </div>

          <nav
            className="mt-5 flex gap-1 overflow-x-auto border-b border-border custom-scrollbar pb-px"
            aria-label="Workspace navigation"
          >
            {tabs.map((tab) => {
              const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`-mb-px flex shrink-0 items-center whitespace-nowrap border-b-2 px-3.5 py-2.5 text-xs sm:text-sm font-medium transition-colors ${
                    active
                      ? 'border-accent text-accent font-semibold'
                      : 'border-transparent text-mineral hover:border-border hover:text-graphite'
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
    </WorkspaceContext.Provider>
  );
}

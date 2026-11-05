'use client';

import type { WorkspaceDetails } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { Alert, Badge } from '@/components/ui';
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
      <div className="space-y-4">
        <Alert>
          {query.error.status === 404
            ? 'This workspace does not exist, was archived, or you are not a member.'
            : query.error.message}
        </Alert>
        <Link href="/" className="text-sm underline">
          Back to workspaces
        </Link>
      </div>
    );
  }
  if (!query.data) return <p className="text-sm text-neutral-500">Loading workspace…</p>;

  const { workspace } = query.data;
  const base = `/workspaces/${workspace.id}`;
  const tabs = [
    { href: base, label: 'Overview' },
    { href: `${base}/members`, label: 'Members' },
    ...(isAdmin(workspace.role) ? [{ href: `${base}/settings`, label: 'Settings' }] : []),
  ];

  return (
    <WorkspaceContext.Provider value={{ workspace, reload: query.reload }}>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
            <Badge tone={workspace.role === 'OWNER' ? 'blue' : 'neutral'}>
              {ROLE_LABEL[workspace.role]}
            </Badge>
          </div>
          <nav className="mt-4 flex gap-1 border-b border-neutral-200" aria-label="Workspace">
            {tabs.map((tab) => {
              const active = pathname === tab.href;
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
    </WorkspaceContext.Provider>
  );
}

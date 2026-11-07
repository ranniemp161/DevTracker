'use client';

import type { WorkspaceDetails } from '@devtrack/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createContext, useContext, type ReactNode } from 'react';
import { Badge, ErrorState } from '@/components/ui';
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

/** Loads the workspace from the URL and renders its header and tabs. */
export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
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
  if (!query.data) return <p className="text-sm text-fg-subtle">Loading workspace…</p>;

  const { workspace } = query.data;

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
        </div>
        {children}
      </div>
    </WorkspaceContext.Provider>
  );
}

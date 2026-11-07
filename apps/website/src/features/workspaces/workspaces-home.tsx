'use client';

import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui';
import { useSession } from '../session/session-context';
import { ROLE_LABEL } from './permissions';

export function WorkspacesHome() {
  const { workspaces } = useSession();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-graphite">Workspaces</h1>
          <p className="mt-1 text-xs text-mineral">
            Select a workspace to view projects and collaborate with your team.
          </p>
        </div>
        <Link
          href="/workspaces/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover transition-colors"
        >
          <span>+</span>
          <span>New workspace</span>
        </Link>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create a workspace for your engineering team, or ask an administrator to send you an invitation."
          action={
            <Link
              href="/workspaces/new"
              className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent-hover"
            >
              Create a workspace
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/workspaces/${w.id}`}
                className="group block rounded-xl border border-border bg-surface p-5 shadow-xs transition-all duration-150 hover:border-border-strong hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-graphite group-hover:text-accent-text transition-colors truncate">
                      {w.name}
                    </h2>
                    <p className="mt-1 font-mono text-xs text-mineral truncate">{w.slug}</p>
                  </div>
                  <Badge tone={w.role === 'OWNER' ? 'teal' : 'neutral'}>{ROLE_LABEL[w.role]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

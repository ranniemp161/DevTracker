'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui';
import { useSession } from '../session/session-context';
import { ROLE_LABEL } from './permissions';

export function WorkspacesHome() {
  const { workspaces } = useSession();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <Link
          href="/workspaces/new"
          className="inline-flex h-9 items-center rounded-control bg-primary px-3.5 text-sm font-medium text-fg-on-inverse transition-colors hover:bg-primary-hover"
        >
          New workspace
        </Link>
      </div>

      {workspaces.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line-control bg-surface p-10 text-center">
          <h2 className="font-medium">You are not in any workspace yet</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Create one for your team, or ask an admin to invite you.
          </p>
          <Link
            href="/workspaces/new"
            className="mt-4 inline-block inline-flex h-9 items-center rounded-control bg-primary px-3.5 text-sm font-medium text-fg-on-inverse transition-colors hover:bg-primary-hover"
          >
            Create a workspace
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-cards gap-4">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/workspaces/${w.id}`}
                className="block rounded-panel border border-line bg-surface p-5 transition-colors hover:border-line-control"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-fg">{w.name}</p>
                    <p className="font-mono text-xs text-fg-subtle">{w.slug}</p>
                  </div>
                  <Badge tone={w.role === 'OWNER' ? 'blue' : 'neutral'}>{ROLE_LABEL[w.role]}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

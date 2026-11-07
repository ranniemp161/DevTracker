'use client';

import Link from 'next/link';
import { ChevronRightIcon, PlusIcon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { useSession } from '../session/session-context';
import { ROLE_LABEL } from './permissions';

export function WorkspacesHome() {
  const { workspaces } = useSession();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your workspaces</h1>
          <p className="mt-1 text-sm text-fg-muted">Choose a workspace to continue.</p>
        </div>
        <Link
          href="/workspaces/new"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-control bg-primary px-3.5 text-sm font-medium text-fg-on-inverse transition-colors hover:bg-primary-hover sm:h-9"
        >
          <PlusIcon size={16} />
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
            className="mt-4 inline-flex h-11 items-center rounded-control bg-primary px-3.5 text-sm font-medium text-fg-on-inverse transition-colors hover:bg-primary-hover sm:h-9"
          >
            Create a workspace
          </Link>
        </div>
      ) : (
        <ul aria-label="Your workspaces" className="space-y-3">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/workspaces/${w.id}`}
                className="group flex items-center gap-3 rounded-panel border border-line bg-surface p-4 transition-colors hover:border-line-control hover:bg-surface-sunken sm:gap-4"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-card bg-primary-soft text-lg font-semibold text-primary-soft-fg"
                >
                  {Array.from(w.name.trim())[0]?.toLocaleUpperCase() ?? 'W'}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-semibold text-fg" title={w.name}>
                      {w.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-fg-subtle" title={w.slug}>
                      {w.slug}
                    </p>
                  </div>
                  <Badge tone={w.role === 'OWNER' ? 'green' : 'neutral'}>
                    {ROLE_LABEL[w.role]}
                  </Badge>
                </div>
                <ChevronRightIcon
                  size={18}
                  className="shrink-0 text-fg-subtle group-hover:text-primary"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

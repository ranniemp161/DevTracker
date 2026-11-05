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
          className="rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          New workspace
        </Link>
      </div>

      {workspaces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
          <h2 className="font-medium">You are not in any workspace yet</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Create one for your team, or ask an admin to invite you.
          </p>
          <Link
            href="/workspaces/new"
            className="mt-4 inline-block rounded-md bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create a workspace
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/workspaces/${w.id}`}
                className="block rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{w.name}</p>
                    <p className="text-sm text-neutral-500">{w.slug}</p>
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

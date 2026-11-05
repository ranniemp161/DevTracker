'use client';

import Link from 'next/link';
import { Card } from '@/components/ui';
import { ROLE_LABEL } from './permissions';
import { useWorkspace } from './workspace-context';

export function WorkspaceOverview() {
  const { workspace } = useWorkspace();
  const created = new Date(workspace.createdAt).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <p className="text-sm text-neutral-500">Members</p>
        <p className="mt-1 text-2xl font-semibold">{workspace.memberCount}</p>
        <Link
          href={`/workspaces/${workspace.id}/members`}
          className="mt-2 inline-block text-sm underline"
        >
          View members
        </Link>
      </Card>
      <Card>
        <p className="text-sm text-neutral-500">Your role</p>
        <p className="mt-1 text-2xl font-semibold">{ROLE_LABEL[workspace.role]}</p>
      </Card>
      <Card>
        <p className="text-sm text-neutral-500">Created</p>
        <p className="mt-1 text-2xl font-semibold">{created}</p>
        <p className="mt-2 text-sm text-neutral-500">Slug: {workspace.slug}</p>
      </Card>
    </div>
  );
}

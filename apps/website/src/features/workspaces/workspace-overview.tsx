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
        <p className="text-xs font-medium text-mineral">Team members</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-graphite">
          {workspace.memberCount}
        </p>
        <Link
          href={`/workspaces/${workspace.id}/members`}
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-hover transition-colors"
        >
          <span>View members</span>
          <span>→</span>
        </Link>
      </Card>

      <Card>
        <p className="text-xs font-medium text-mineral">Your workspace role</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-graphite">
          {ROLE_LABEL[workspace.role]}
        </p>
        <p className="mt-3 text-xs text-mineral-muted">
          {workspace.role === 'OWNER'
            ? 'Full administrative control'
            : workspace.role === 'ADMIN'
              ? 'Can manage projects and members'
              : 'Standard contributor access'}
        </p>
      </Card>

      <Card>
        <p className="text-xs font-medium text-mineral">Created date</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-graphite">{created}</p>
        <p className="mt-3 font-mono text-xs text-mineral-muted">Slug: {workspace.slug}</p>
      </Card>
    </div>
  );
}

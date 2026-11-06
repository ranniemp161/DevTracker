'use client';

import type { WorkspaceMember } from '@devtrack/types';
import { useState } from 'react';
import { Alert, Avatar, Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from './project-context';

export function ProjectMembers() {
  const { project, members, readOnly, reload, reloadMembers } = useProject();
  const canManage = project.viewerCanManage && !readOnly;
  const workspaceMembers = useApiQuery<WorkspaceMember[]>(
    canManage ? `/workspaces/${project.workspaceId}/members` : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reloadMembers();
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const addable = (workspaceMembers.data ?? []).filter(
    (wm) => !members.some((m) => m.user.id === wm.user.id),
  );

  return (
    <Card
      title="Project members"
      description="Workspace members can only see projects they belong to. Workspace admins see every project."
    >
      {error ? <Alert>{error}</Alert> : null}
      <ul className="divide-y divide-neutral-100">
        {members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={m.user.username} url={m.user.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">@{m.user.username}</p>
              <p className="truncate text-sm text-neutral-500">{m.user.email}</p>
            </div>
            {canManage ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  call(() =>
                    api(`/projects/${project.id}/members/${m.user.id}`, { method: 'DELETE' }),
                  )
                }
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <label className="mt-4 block max-w-sm text-sm">
          <span className="mb-1.5 block font-medium text-neutral-800">Add a workspace member</span>
          <select
            value=""
            disabled={busy || addable.length === 0}
            onChange={(e) =>
              e.target.value &&
              call(() =>
                api(`/projects/${project.id}/members`, { body: { userId: e.target.value } }),
              )
            }
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-2 text-sm"
          >
            <option value="">
              {addable.length === 0 ? 'Everyone is already a member' : 'Choose a person…'}
            </option>
            {addable.map((wm) => (
              <option key={wm.user.id} value={wm.user.id}>
                @{wm.user.username} ({wm.user.email})
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </Card>
  );
}

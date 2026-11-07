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
      {error ? <Alert tone="error">{error}</Alert> : null}
      <ul className="divide-y divide-border/60">
        {members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 py-3">
            <Avatar name={m.user.username} url={m.user.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-graphite">@{m.user.username}</p>
              <p className="truncate text-xs text-mineral">{m.user.email}</p>
            </div>
            {canManage ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  call(() =>
                    api(`/projects/${project.id}/members/${m.user.id}`, { method: 'DELETE' }),
                  )
                }
                className="text-mineral hover:text-red-700"
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <div className="mt-5 pt-4 border-t border-border/70">
          <label className="block max-w-sm text-xs">
            <span className="mb-1.5 block font-medium text-mineral">Add a workspace member</span>
            <select
              value=""
              disabled={busy || addable.length === 0}
              onChange={(e) =>
                e.target.value &&
                call(() =>
                  api(`/projects/${project.id}/members`, { body: { userId: e.target.value } }),
                )
              }
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-graphite focus:border-accent focus:outline-none cursor-pointer"
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
        </div>
      ) : null}
    </Card>
  );
}

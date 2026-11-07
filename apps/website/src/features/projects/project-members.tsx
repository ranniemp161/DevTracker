'use client';

import type { WorkspaceMember } from '@devtrack/types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Avatar, Button, SettingsSection } from '@/components/ui';
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
    <SettingsSection
      id="members"
      title="Members"
      description="Workspace members can only see projects they belong to. Workspace admins see every project."
    >
      {error ? <Alert>{error}</Alert> : null}
      <ul className="divide-y divide-line-subtle">
        {members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={m.user.username} url={m.user.avatarUrl} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">@{m.user.username}</p>
              <p className="truncate text-sm text-fg-subtle">{m.user.email}</p>
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
          <span className="mb-1.5 block font-medium text-fg-secondary">Add a workspace member</span>
          <select
            value=""
            disabled={busy || addable.length === 0}
            onChange={(e) =>
              e.target.value &&
              call(() =>
                api(`/projects/${project.id}/members`, { body: { userId: e.target.value } }),
              )
            }
            className="w-full rounded-control border border-line-control bg-surface px-2 py-2 text-sm"
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
    </SettingsSection>
  );
}

/**
 * The /members route. Admins manage members from Settings (#members), so they are sent there;
 * everyone else keeps this read-only list, because project settings are admin-only.
 */
export function ProjectMembersPage() {
  const router = useRouter();
  const { project, readOnly } = useProject();
  const toSettings = project.viewerCanManage && !readOnly;
  useEffect(() => {
    if (toSettings) router.replace(`/projects/${project.id}/settings#members`);
  }, [toSettings, router, project.id]);
  return toSettings ? null : <ProjectMembers />;
}

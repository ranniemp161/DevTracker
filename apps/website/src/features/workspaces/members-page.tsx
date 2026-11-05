'use client';

import type { Invitation, WorkspaceMember, WorkspaceRole } from '@devtrack/types';
import { createInvitationSchema } from '@devtrack/validators';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Avatar, Badge, Button, Card, Field, Select, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { useAuthForm } from '../auth/use-auth-form';
import { useSession } from '../session/session-context';
import { canManageMember, isAdmin, ROLE_LABEL } from './permissions';
import { useWorkspace } from './workspace-context';

export function MembersPage() {
  const { workspace } = useWorkspace();
  const members = useApiQuery<WorkspaceMember[]>(`/workspaces/${workspace.id}/members`);
  const invitations = useApiQuery<Invitation[]>(
    isAdmin(workspace.role) ? `/workspaces/${workspace.id}/invitations` : null,
  );

  return (
    <div className="space-y-6">
      {isAdmin(workspace.role) ? (
        <InvitePanel onInvited={invitations.reload} invitations={invitations} />
      ) : null}
      <Card title="Members" description={`${members.data?.length ?? workspace.memberCount} people`}>
        {members.error ? <Alert>{members.error.message}</Alert> : null}
        {!members.data ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {members.data.map((m) => (
              <MemberRow key={m.user.id} member={m} onChanged={members.reload} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MemberRow({ member, onChanged }: { member: WorkspaceMember; onChanged: () => void }) {
  const router = useRouter();
  const { user: me, reloadWorkspaces } = useSession();
  const { workspace, reload: reloadWorkspace } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const isSelf = member.user.id === me.id;
  const canManage = canManageMember(workspace.role, member.role);
  const canLeave = isSelf && member.role !== 'OWNER';

  async function run(action: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const changeRole = (role: WorkspaceRole) =>
    run(
      () =>
        api(`/workspaces/${workspace.id}/members/${member.user.id}`, {
          method: 'PATCH',
          body: { role },
        }),
      onChanged,
    );

  const remove = () =>
    run(
      () => api(`/workspaces/${workspace.id}/members/${member.user.id}`, { method: 'DELETE' }),
      () => {
        if (isSelf) {
          reloadWorkspaces();
          router.push('/');
        } else {
          onChanged();
          reloadWorkspace();
        }
      },
    );

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Avatar name={member.user.username} url={member.user.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          @{member.user.username} {isSelf ? <span className="text-neutral-500">(you)</span> : null}
        </p>
        <p className="truncate text-sm text-neutral-500">{member.user.email}</p>
        {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
      </div>

      {canManage && !isSelf ? (
        <label className="text-sm">
          <span className="sr-only">Role for @{member.user.username}</span>
          <select
            value={member.role}
            disabled={busy}
            onChange={(e) => changeRole(e.target.value as WorkspaceRole)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
          >
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
          </select>
        </label>
      ) : (
        <Badge tone={member.role === 'OWNER' ? 'blue' : 'neutral'}>{ROLE_LABEL[member.role]}</Badge>
      )}

      {(canManage && !isSelf) || canLeave ? (
        confirming ? (
          <span className="flex items-center gap-2">
            <Button variant="danger" size="sm" disabled={busy} onClick={remove}>
              {isSelf ? 'Confirm leave' : 'Confirm remove'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            {isSelf ? 'Leave' : 'Remove'}
          </Button>
        )
      ) : null}
    </li>
  );
}

function InvitePanel({
  invitations,
  onInvited,
}: {
  invitations: ReturnType<typeof useApiQuery<Invitation[]>>;
  onInvited: () => void;
}) {
  const { workspace } = useWorkspace();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useAuthForm(
    createInvitationSchema,
    { email: '', role: 'MEMBER' },
    async (values) => {
      await api(`/workspaces/${workspace.id}/invitations`, { body: values });
      setSentTo(values.email);
      onInvited();
    },
  );

  return (
    <Card
      title="Invite people"
      description="Invitations are sent by email and expire after 7 days. Only the invited address can accept."
    >
      <form onSubmit={form.onSubmit} noValidate className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Field
            label="Email"
            name="email"
            type="email"
            placeholder="teammate@company.com"
            value={form.values.email}
            onChange={form.onChange}
            error={form.fieldErrors.email}
          />
        </div>
        <div className="w-36">
          <Select label="Role" name="role" value={form.values.role} onChange={form.onChange}>
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </div>
        <div className="w-36">
          <SubmitButton pending={form.pending}>Send invite</SubmitButton>
        </div>
      </form>
      <div className="mt-3 space-y-3">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        {sentTo && !form.formError ? (
          <Alert tone="success">Invitation sent to {sentTo}.</Alert>
        ) : null}
      </div>

      <h3 className="mt-6 text-sm font-medium text-neutral-800">Pending invitations</h3>
      {invitations.error ? <Alert>{invitations.error.message}</Alert> : null}
      {invitations.data && invitations.data.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">No pending invitations.</p>
      ) : null}
      <ul className="mt-2 divide-y divide-neutral-100">
        {invitations.data?.map((inv) => (
          <InvitationRow key={inv.id} invitation={inv} onChanged={invitations.reload} />
        ))}
      </ul>
    </Card>
  );
}

function InvitationRow({
  invitation,
  onChanged,
}: {
  invitation: Invitation;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expires = new Date(invitation.expiresAt).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api(`/invitations/${invitation.id}/revoke`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke the invitation.');
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invitation.email}</p>
        <p className="text-xs text-neutral-500">
          {ROLE_LABEL[invitation.role]} · invited by @{invitation.invitedBy?.username ?? 'unknown'}{' '}
          · {invitation.status === 'EXPIRED' ? 'expired' : `expires ${expires}`}
        </p>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
      {invitation.status === 'EXPIRED' ? (
        <Badge tone="amber">Expired</Badge>
      ) : (
        <Badge>Pending</Badge>
      )}
      <Button variant="ghost" size="sm" disabled={busy} onClick={revoke}>
        Revoke
      </Button>
    </li>
  );
}

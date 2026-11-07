'use client';

import type { AcceptInvitationResult, PublicUser } from '@devtrack/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { AuthCard } from '../auth/components/ui';
import { clearPendingInvitation, usePendingInvitation } from './pending-invitation';

const NEXT = encodeURIComponent('/invitations/accept');

/**
 * Landing page for invitation links (`/invitations/accept#token=…`). The token is remembered
 * for this tab, so the invitee can sign in, sign up and verify their email, then come back.
 */
export function AcceptInvitation() {
  const router = useRouter();
  const token = usePendingInvitation();
  const me = useApiQuery<{ user: PublicUser }>(token ? '/auth/me' : null);
  const [state, setState] = useState<'idle' | 'accepting' | { error: ApiError }>('idle');

  async function accept() {
    if (!token) return;
    setState('accepting');
    try {
      const { workspace } = await api<AcceptInvitationResult>('/invitations/accept', {
        body: { token },
      });
      clearPendingInvitation();
      router.push(`/workspaces/${workspace.id}`);
    } catch (err) {
      const error =
        err instanceof ApiError ? err : new ApiError(0, 'INTERNAL_ERROR', 'Something went wrong.');
      if (error.code === 'INVITATION_INVALID') clearPendingInvitation();
      setState({ error });
    }
  }

  async function switchAccount() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push(`/login?next=${NEXT}`);
  }

  if (token === undefined) return <AuthCard title="Workspace invitation">{null}</AuthCard>;

  if (token === null) {
    return (
      <AuthCard title="Workspace invitation">
        <Alert>
          This invitation link is incomplete or was already used. Ask a workspace admin to send a
          new one.
        </Alert>
        <Link href="/" className="mt-4 block text-center text-sm underline">
          Go to DevTrack
        </Link>
      </AuthCard>
    );
  }

  const signedOut = me.error?.status === 401;
  const user = me.data?.user;

  return (
    <AuthCard title="Join a workspace" subtitle="You have been invited to a DevTrack workspace.">
      <div className="space-y-4">
        {me.loading ? <p className="text-sm text-fg-subtle">Checking your session…</p> : null}
        {me.error && !signedOut ? <Alert>{me.error.message}</Alert> : null}

        {signedOut ? (
          <>
            <p className="text-sm text-fg-secondary">
              Sign in, or create an account, with the email address the invitation was sent to.
            </p>
            <div className="flex gap-3">
              <Link
                href={`/login?next=${NEXT}`}
                className="flex-1 rounded-control bg-fg px-4 py-2 text-center text-sm font-medium text-fg-on-inverse hover:bg-fg-secondary"
              >
                Sign in
              </Link>
              <Link
                href={`/register?next=${NEXT}`}
                className="flex-1 rounded-control border border-line-control px-4 py-2 text-center text-sm font-medium hover:bg-surface-sunken"
              >
                Create account
              </Link>
            </div>
          </>
        ) : null}

        {user && !user.emailVerified ? (
          <Alert tone="info">
            Verify <strong>{user.email}</strong> first: open the link we emailed you, then come back
            to this page. Your invitation is saved in this browser tab.
          </Alert>
        ) : null}

        {user && user.emailVerified ? (
          <>
            <p className="text-sm text-fg-secondary">
              Signed in as <strong>@{user.username}</strong> ({user.email}).
            </p>
            {typeof state === 'object' ? (
              <Alert>
                {state.error.message}
                {state.error.code === 'INVITATION_EMAIL_MISMATCH' ? (
                  <button
                    type="button"
                    onClick={switchAccount}
                    className="mt-2 block font-medium underline"
                  >
                    Sign in with a different account
                  </button>
                ) : null}
              </Alert>
            ) : null}
            {typeof state === 'object' && state.error.code === 'INVITATION_INVALID' ? (
              <Link href="/" className="block text-center text-sm underline">
                Go to DevTrack
              </Link>
            ) : (
              <Button
                variant="primary"
                className="w-full"
                disabled={state === 'accepting'}
                onClick={accept}
              >
                {state === 'accepting' ? 'Joining…' : 'Accept invitation'}
              </Button>
            )}
          </>
        ) : null}
      </div>
    </AuthCard>
  );
}

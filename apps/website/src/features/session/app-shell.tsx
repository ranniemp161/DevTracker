'use client';

import type { PublicUser, WorkspaceSummary } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Avatar, Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { RealtimeProvider } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { NotificationBell } from '../collaboration/notification-bell';
import { usePendingInvitation } from '../invitations/pending-invitation';
import { SessionContext, type Session } from './session-context';

/** Layout for signed-in pages: loads the session, renders the header, guards access. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useApiQuery<{ user: PublicUser }>('/auth/me');
  const verified = me.data?.user.emailVerified ?? false;
  const workspaces = useApiQuery<WorkspaceSummary[]>(verified ? '/workspaces' : null);

  useEffect(() => {
    if (me.error?.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, pathname, router]);

  const reloadWorkspaces = workspaces.reload;
  const session = useMemo<Session | null>(
    () =>
      me.data ? { user: me.data.user, workspaces: workspaces.data ?? [], reloadWorkspaces } : null,
    [me.data, workspaces.data, reloadWorkspaces],
  );

  if (me.error && me.error.status !== 401) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert>{me.error.message}</Alert>
      </div>
    );
  }
  if (!session || (verified && workspaces.loading)) {
    return <p className="p-8 text-sm text-neutral-500">Loading…</p>;
  }

  const page = (
    <div className="min-h-dvh">
      <Header user={session.user} workspaces={session.workspaces} />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <PendingInvitationBanner />
        {verified ? children : <VerifyEmailNotice user={session.user} />}
      </main>
    </div>
  );

  // Real-time updates need a verified account (the API refuses other connections).
  return (
    <SessionContext.Provider value={session}>
      {verified ? <RealtimeProvider>{page}</RealtimeProvider> : page}
    </SessionContext.Provider>
  );
}

function Header({ user, workspaces }: { user: PublicUser; workspaces: WorkspaceSummary[] }) {
  const router = useRouter();
  const params = useParams<{ id?: string }>();

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          DevTrack
        </Link>
        {workspaces.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Workspace</span>
            <select
              value={workspaces.some((w) => w.id === params.id) ? params.id : ''}
              onChange={(e) => router.push(e.target.value ? `/workspaces/${e.target.value}` : '/')}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
            >
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="ml-auto flex items-center gap-3">
          {user.emailVerified ? <NotificationBell /> : null}
          <Avatar name={user.username} url={user.avatarUrl} size="sm" />
          <span className="hidden text-sm text-neutral-700 sm:inline">@{user.username}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

function PendingInvitationBanner() {
  const pending = usePendingInvitation();
  const pathname = usePathname();
  if (!pending || pathname === '/invitations/accept') return null;
  return (
    <Alert tone="info">
      You have a pending workspace invitation.{' '}
      <Link href="/invitations/accept" className="font-medium underline">
        Review it
      </Link>
    </Alert>
  );
}

function VerifyEmailNotice({ user }: { user: PublicUser }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle');

  async function resend() {
    setState('sending');
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setState('sent');
    } catch (err) {
      setState({ error: err instanceof ApiError ? err.message : 'Could not send the email.' });
    }
  }

  return (
    <section className="mx-auto max-w-lg rounded-xl border border-neutral-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Verify your email</h1>
      <p className="mt-2 text-sm text-neutral-600">
        We sent a verification link to <strong>{user.email}</strong>. Verify it to create or join
        workspaces.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {state === 'sent' ? (
          <span className="text-sm font-medium text-green-700">Sent — check your inbox.</span>
        ) : (
          <Button onClick={resend} disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Resend verification email'}
          </Button>
        )}
      </div>
      {typeof state === 'object' ? (
        <p className="mt-2 text-sm text-red-700">{state.error}</p>
      ) : null}
    </section>
  );
}

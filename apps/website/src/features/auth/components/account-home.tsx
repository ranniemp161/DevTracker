'use client';

import type { PublicUser } from '@devtrack/types';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from './ui';

type State =
  | { status: 'loading' }
  | { status: 'ready'; user: PublicUser }
  | { status: 'error'; message: string };

/**
 * M1 landing page for signed-in users: who you are, email verification status, sign out.
 * Workspaces and projects arrive in M2/M3.
 */
export function AccountHome() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | string>('idle');

  useEffect(() => {
    let cancelled = false;
    api<{ user: PublicUser }>('/auth/me').then(
      ({ user }) => !cancelled && setState({ status: 'ready', user }),
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load.',
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  async function resendVerification() {
    setResend('sending');
    try {
      await api('/auth/resend-verification', { method: 'POST' });
      setResend('sent');
    } catch (err) {
      setResend(err instanceof ApiError ? err.message : 'Could not send the email.');
    }
  }

  if (state.status === 'loading') {
    return <p className="p-8 text-sm text-neutral-500">Loading…</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert>{state.message}</Alert>
      </div>
    );
  }

  const { user } = state;
  return (
    <div className="min-h-dvh">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <span className="font-semibold tracking-tight">DevTrack</span>
          <button
            type="button"
            onClick={logout}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        {!user.emailVerified ? (
          <Alert tone="info">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Verify <strong>{user.email}</strong> to start using workspaces. Check your inbox for
                the link.
              </span>
              {resend === 'sent' ? (
                <span className="font-medium">Sent — check your inbox.</span>
              ) : (
                <button
                  type="button"
                  onClick={resendVerification}
                  disabled={resend === 'sending'}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1 font-medium hover:bg-neutral-50 disabled:opacity-60"
                >
                  {resend === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )}
            </div>
            {resend !== 'idle' && resend !== 'sending' && resend !== 'sent' ? (
              <p className="mt-2 text-red-700">{resend}</p>
            ) : null}
          </Alert>
        ) : null}

        <section className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-6">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="size-12 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-full bg-neutral-200 font-semibold uppercase">
              {user.username.slice(0, 1)}
            </div>
          )}
          <div>
            <p className="font-medium">@{user.username}</p>
            <p className="text-sm text-neutral-600">{user.email}</p>
          </div>
          <span
            className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
              user.emailVerified ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {user.emailVerified ? 'Email verified' : 'Email not verified'}
          </span>
        </section>
      </main>
    </div>
  );
}

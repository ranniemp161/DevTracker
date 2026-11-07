'use client';

import type { PublicUser, WorkspaceSummary } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Avatar, Button, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { RealtimeProvider } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { NotificationBell } from '../collaboration/notification-bell';
import { usePendingInvitation } from '../invitations/pending-invitation';
import { clearChatDrafts } from '../chat/chat-drafts';
import { SessionContext, type Session } from './session-context';

/** Layout for signed-in pages: loads the session, renders the header, guards access. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useApiQuery<{ user: PublicUser }>('/auth/me');
  const verified = me.data?.user.emailVerified ?? false;
  const workspaces = useApiQuery<WorkspaceSummary[]>(verified ? '/workspaces' : null);

  useEffect(() => {
    if (me.error?.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [me.error, pathname, router]);

  const reloadWorkspaces = workspaces.reload;
  const session = useMemo<Session | null>(
    () =>
      me.data ? { user: me.data.user, workspaces: workspaces.data ?? [], reloadWorkspaces } : null,
    [me.data, workspaces.data, reloadWorkspaces],
  );

  if (me.error && me.error.status !== 401) {
    return (
      <div className="mx-auto max-w-xl p-6 sm:p-12">
        <ErrorState
          message={me.error.message || 'Unable to connect to your account session.'}
          onRetry={() => {
            me.reload();
            if (verified) workspaces.reload();
          }}
        />
      </div>
    );
  }

  if (!session || (verified && workspaces.loading)) {
    return (
      <div className="min-h-dvh bg-canvas">
        {/* Header skeleton */}
        <div className="border-b border-border bg-surface px-4 sm:px-6 py-3">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-6 w-24 rounded" />
              <Skeleton className="h-8 w-36 rounded-lg" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-lg" />
            </div>
          </div>
        </div>
        {/* Main content skeleton */}
        <main className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </main>
      </div>
    );
  }

  // Work surfaces (Board, List, Chat, Tasks) utilize wide 1600px container; forms constrain themselves.
  const page = (
    <div className="min-h-dvh bg-canvas flex flex-col">
      {/* Accessible skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-md"
      >
        Skip to content
      </a>

      <Header user={session.user} workspaces={session.workspaces} />

      <main
        id="main-content"
        className="mx-auto w-full max-w-[1600px] flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-6"
      >
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
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const isProjectRoute = pathname.startsWith('/projects/') && Boolean(params.id);
  const projectQuery = useApiQuery<{
    project: { id: string; name: string; key: string; workspaceId: string };
  }>(isProjectRoute ? `/projects/${params.id}` : null);

  const activeWorkspaceId = useMemo(() => {
    if (pathname.startsWith('/workspaces/') && params.id) {
      return params.id;
    }
    if (isProjectRoute && projectQuery.data?.project.workspaceId) {
      return projectQuery.data.project.workspaceId;
    }
    return '';
  }, [pathname, params.id, isProjectRoute, projectQuery.data]);

  async function logout() {
    clearChatDrafts();
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur-xs">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 py-2.5">
        {/* Brand & Workspace switcher & Breadcrumb */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 group shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 rounded-lg p-1"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-white font-bold text-xs tracking-wider shadow-xs group-hover:bg-accent-hover transition-colors">
              DT
            </div>
            <span className="font-semibold tracking-tight text-graphite text-base sm:text-lg">
              DevTrack
            </span>
          </Link>

          {workspaces.length > 0 ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-border-strong hidden sm:inline" aria-hidden="true">
                /
              </span>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="sr-only">Active workspace</span>
                <div className="relative">
                  <select
                    value={activeWorkspaceId}
                    onChange={(e) =>
                      router.push(e.target.value ? `/workspaces/${e.target.value}` : '/')
                    }
                    className="appearance-none rounded-lg border border-border bg-subtle/50 hover:bg-subtle py-1.5 pl-2.5 pr-7 text-xs font-medium text-graphite transition-colors focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15 cursor-pointer max-w-[140px] sm:max-w-[200px] truncate"
                  >
                    <option value="">All workspaces</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-mineral"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </label>

              {/* Breadcrumb to project if inside project */}
              {isProjectRoute && projectQuery.data?.project ? (
                <div className="hidden md:flex items-center gap-2 min-w-0 text-xs">
                  <span className="text-border-strong" aria-hidden="true">
                    /
                  </span>
                  <Link
                    href={`/projects/${projectQuery.data.project.id}`}
                    className="truncate font-medium text-mineral hover:text-graphite transition-colors"
                  >
                    {projectQuery.data.project.name}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Right controls: Notifications, User profile, Sign out */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {user.emailVerified ? (
            <div className="flex items-center justify-center min-w-[36px] min-h-[36px]">
              <NotificationBell />
            </div>
          ) : null}

          <div className="flex items-center gap-2 pl-1 border-l border-border/80">
            <Avatar name={user.username} url={user.avatarUrl} size="sm" />
            <span className="hidden text-xs font-medium text-graphite sm:inline">
              @{user.username}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-xs text-mineral hover:text-graphite min-h-[36px] px-2 sm:px-3"
          >
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
      <Link href="/invitations/accept" className="font-semibold underline hover:text-sky-950">
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
    <section className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xs">
      <h1 className="text-lg font-semibold text-graphite">Verify your email</h1>
      <p className="mt-2 text-sm text-mineral leading-relaxed">
        We sent a verification link to <strong className="text-graphite">{user.email}</strong>.
        Verify it to create or join workspaces.
      </p>
      <div className="mt-5 flex items-center gap-3">
        {state === 'sent' ? (
          <span className="text-sm font-medium text-emerald-700">Sent — check your inbox.</span>
        ) : (
          <Button variant="primary" onClick={resend} disabled={state === 'sending'}>
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

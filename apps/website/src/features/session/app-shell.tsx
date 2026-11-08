'use client';

import type { Project, ProjectChatUnreadSummary, PublicUser } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DevtrackMark, MenuIcon } from '@/components/icons';
import { Alert, Avatar, Button, IconButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { RealtimeProvider, useRealtimeRefresh, type RealtimeEvent } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { NotificationBell } from '../collaboration/notification-bell';
import { usePendingInvitation } from '../invitations/pending-invitation';
import { clearChatDrafts } from '../chat/chat-drafts';
import { SessionContext, type Session } from './session-context';
import { ShellDataContext } from './shell-data';
import { Sidebar } from './sidebar';

/** Layout for signed-in pages: loads the session, renders the navigation, guards access. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useApiQuery<{ user: PublicUser }>('/auth/me');
  const verified = me.data?.user.emailVerified ?? false;
  const workspaces = useApiQuery<Session['workspaces']>(verified ? '/workspaces' : null);

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
    return <p className="p-8 text-sm text-fg-subtle">Loading…</p>;
  }

  const page = verified ? (
    <VerifiedFrame session={session}>{children}</VerifiedFrame>
  ) : (
    <div className="min-h-dvh bg-bg">
      <header className="flex h-13 items-center justify-between border-b border-line bg-surface px-4">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <DevtrackMark size={24} />
          DevTrack
        </span>
        <Button variant="ghost" size="sm" onClick={() => signOut(router)}>
          Sign out
        </Button>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-7">
        <PendingInvitationBanner />
        <VerifyEmailNotice user={session.user} />
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

async function signOut(router: ReturnType<typeof useRouter>) {
  clearChatDrafts();
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  router.replace('/login');
  router.refresh();
}

const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(DESKTOP_QUERY);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

function isProjectEvent(e: RealtimeEvent): boolean {
  const action = (e.payload as { action?: string }).action ?? '';
  return e.type === 'activity.created' && action.startsWith('project.');
}

/** Sidebar + inset main panel (desktop), or a top bar with a drawer (below 1024px). */
function VerifiedFrame({ session, children }: { session: Session; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const isDesktop = useIsDesktop();
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const { user, workspaces } = session;

  const isProjectRoute = pathname.startsWith('/projects/') && Boolean(params.id);
  const projectQuery = useApiQuery<{ project: { workspaceId: string } }>(
    isProjectRoute ? `/projects/${params.id}` : null,
  );
  const activeWorkspaceId = useMemo(() => {
    if (pathname.startsWith('/workspaces/') && params.id) return params.id;
    if (isProjectRoute && projectQuery.data?.project.workspaceId) {
      return projectQuery.data.project.workspaceId;
    }
    return '';
  }, [pathname, params.id, isProjectRoute, projectQuery.data]);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const projects = useApiQuery<Project[]>(
    activeWorkspace ? `/workspaces/${activeWorkspace.id}/projects` : null,
  );
  const chatUnread = useApiQuery<ProjectChatUnreadSummary[]>(
    activeWorkspace ? `/workspaces/${activeWorkspace.id}/chat/unread` : null,
  );
  const reloadProjects = projects.reload;
  const reloadChatUnread = chatUnread.reload;
  useRealtimeRefresh(isProjectEvent, reloadProjects);
  useRealtimeRefresh((e) => e.type.startsWith('chat.'), reloadChatUnread);
  const shellData = useMemo(() => ({ reloadChatUnread }), [reloadChatUnread]);

  // The drawer is open only for the page it was opened on, so navigating closes it.
  const drawerOpen = !isDesktop && drawerPath === pathname;
  const closeDrawer = () => setDrawerPath(null);

  const sidebar = (showBell: boolean) => (
    <Sidebar
      user={user}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      projects={projects.data ?? []}
      chatUnread={chatUnread.data ?? []}
      currentProjectId={isProjectRoute ? (params.id ?? null) : null}
      onWorkspaceChange={(id) => router.push(id ? `/workspaces/${id}` : '/')}
      onLogout={() => signOut(router)}
      onNavigate={closeDrawer}
      showBell={showBell}
    />
  );

  const content = (
    <div className="px-4 py-6 sm:px-7">
      <div className="space-y-6">
        <PendingInvitationBanner />
        {children}
      </div>
    </div>
  );

  return (
    <ShellDataContext.Provider value={shellData}>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 text-sm font-medium text-fg shadow-overlay focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {pathname === '/' ? (
        <div className="min-h-dvh bg-bg">
          <header className="border-b border-line bg-surface">
            <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-7">
              <Link
                href="/"
                aria-label="DevTrack home"
                className="flex shrink-0 items-center gap-2 rounded-control font-semibold tracking-tight"
              >
                <DevtrackMark size={28} />
                DevTrack
              </Link>
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <NotificationBell align="end" />
                <div
                  className="flex min-w-0 items-center gap-2 border-l border-line pl-3"
                  title={`Signed in as @${user.username}`}
                >
                  <Avatar name={user.username} url={user.avatarUrl} seed={user.id} size="sm" />
                  <span className="sr-only sm:not-sr-only sm:max-w-40 sm:truncate sm:text-sm sm:text-fg-secondary">
                    @{user.username}
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => signOut(router)}>
                  Sign out
                </Button>
              </div>
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto max-w-3xl space-y-6 px-4 py-10 focus-visible:shadow-none sm:py-16"
          >
            <PendingInvitationBanner />
            {children}
          </main>
        </div>
      ) : isDesktop ? (
        <div className="flex h-dvh bg-bg">
          <aside className="w-62 shrink-0">{sidebar(true)}</aside>
          <main
            id="main-content"
            tabIndex={-1}
            className="my-2 mr-2 min-w-0 flex-1 overflow-y-auto rounded-panel border border-line bg-surface focus-visible:shadow-none"
          >
            {content}
          </main>
        </div>
      ) : (
        <div className="flex h-dvh flex-col bg-surface">
          <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-3">
            <IconButton
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerPath(pathname)}
            >
              <MenuIcon size={18} />
            </IconButton>
            <DevtrackMark size={24} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {activeWorkspace?.name ?? 'DevTrack'}
            </span>
            <NotificationBell />
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto focus-visible:shadow-none"
          >
            {content}
          </main>
          {drawerOpen ? <Drawer onClose={closeDrawer}>{sidebar(false)}</Drawer> : null}
        </div>
      )}
    </ShellDataContext.Provider>
  );
}

/** Left sheet with a scrim. Closes on Escape or a scrim click and traps focus while open. */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current();
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-fg/40"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-bg shadow-overlay"
      >
        {children}
      </div>
    </div>
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
    <section className="mx-auto max-w-lg rounded-panel border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">Verify your email</h1>
      <p className="mt-2 text-sm text-fg-muted">
        We sent a verification link to <strong>{user.email}</strong>. Verify it to create or join
        workspaces.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {state === 'sent' ? (
          <span className="text-sm font-medium text-status-done-fg">Sent — check your inbox.</span>
        ) : (
          <Button onClick={resend} loading={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Resend verification email'}
          </Button>
        )}
      </div>
      {typeof state === 'object' ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
    </section>
  );
}

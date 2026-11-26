'use client';

import type { MeResponse, Project, ProjectChatUnreadSummary, PublicUser } from '@devtrack/types';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityIcon,
  BoardIcon,
  CalendarIcon,
  ChatIcon,
  DevtrackMark,
  FlagIcon,
  FolderIcon,
  InboxIcon,
  ListIcon,
  MoreIcon,
  MyTasksIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  UsersIcon,
  XIcon,
} from '@/components/icons';
import { ShortcutsHelp } from '@/components/shortcuts-help';
import { ToastProvider } from '@/components/toaster';
import { Alert, Avatar, avatarTone, Button, IconButton, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { clearApiCache, revalidate } from '@/lib/api-cache';
import { forgetLastWorkspace, rememberLastWorkspace } from '@/lib/last-workspace';
import { useFavoriteProjects } from '@/lib/project-prefs';
import { setSidebarCollapsed, useSidebarCollapsed } from '@/lib/sidebar-collapsed';
import { useShortcuts } from '@/lib/shortcuts';
import { RealtimeProvider, useRealtimeRefresh, type RealtimeEvent } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { NotificationBell } from '../collaboration/notification-bell';
import { usePendingInvitation } from '../invitations/pending-invitation';
import { clearChatDrafts } from '../chat/chat-drafts';
import { SearchDialog } from '../search/search-dialog';
import { ActiveTimerBar, TaskTimerProvider } from '../projects/task-timer';
import { SessionContext, type Session } from './session-context';
import { ShellDataContext } from './shell-data';
import { Sidebar } from './sidebar';

/** Layout for signed-in pages: loads the session, renders the navigation, guards access. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useApiQuery<MeResponse>('/auth/me');
  const verified = me.data?.user.emailVerified ?? false;
  // `/auth/me` carries the workspaces for verified users. `/workspaces` is only a fallback
  // for an API that doesn't send them yet.
  const fallback = useApiQuery<Session['workspaces']>(
    verified && !me.data?.workspaces ? '/workspaces' : null,
  );
  const workspaceList = me.data?.workspaces ?? fallback.data;
  usePrefetchRoute(pathname);

  useEffect(() => {
    if (me.error?.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, pathname, router]);

  const reloadMe = me.reload;
  const reloadFallback = fallback.reload;
  const usesFallback = verified && !me.data?.workspaces;
  const reloadWorkspaces = usesFallback ? reloadFallback : reloadMe;
  const session = useMemo<Session | null>(
    () =>
      me.data
        ? {
            user: me.data.user,
            workspaces: workspaceList ?? [],
            reloadWorkspaces,
            reloadUser: reloadMe,
          }
        : null,
    [me.data, workspaceList, reloadWorkspaces, reloadMe],
  );

  if (me.error && me.error.status !== 401) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <Alert>{me.error.message}</Alert>
      </div>
    );
  }
  if (!session || (usesFallback && fallback.loading)) {
    return <ShellSkeleton />;
  }

  const page = verified ? (
    <TaskTimerProvider key={session.user.id}>
      <VerifiedFrame session={session}>{children}</VerifiedFrame>
    </TaskTimerProvider>
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
      <ToastProvider>{verified ? <RealtimeProvider>{page}</RealtimeProvider> : page}</ToastProvider>
    </SessionContext.Provider>
  );
}

/**
 * Starts the requests a page's own layout will make, alongside `/auth/me` instead of after
 * it: the project and its members, or the workspace. The layouts then read them from the
 * cache. Runs once per project or workspace, not on every view change inside it.
 */
function usePrefetchRoute(pathname: string) {
  const match = /^\/(projects|workspaces)\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname);
  const key = match ? `/${match[1]}/${match[2]}` : null;
  useEffect(() => {
    if (!key) return;
    revalidate(key);
    if (key.startsWith('/projects/')) revalidate(`${key}/members`);
  }, [key]);
}

async function signOut(router: ReturnType<typeof useRouter>) {
  clearChatDrafts();
  forgetLastWorkspace();
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  clearApiCache();
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

/** Sidebar and inset panel on desktop, bottom navigation and a menu on smaller screens. */
function VerifiedFrame({ session, children }: { session: Session; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const isDesktop = useIsDesktop();
  const sidebarCollapsed = useSidebarCollapsed();
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const { user, workspaces } = session;

  const isProjectRoute = pathname.startsWith('/projects/') && Boolean(params.id);
  const isMobileChat = !isDesktop && isProjectRoute && pathname.endsWith('/chat');
  const projectQuery = useApiQuery<{ project: Pick<Project, 'name' | 'workspaceId'> }>(
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
  useEffect(() => {
    if (activeWorkspace) rememberLastWorkspace(activeWorkspace.id);
  }, [activeWorkspace]);

  const projects = useApiQuery<Project[]>(
    activeWorkspace ? `/workspaces/${activeWorkspace.id}/projects` : null,
  );
  const chatUnread = useApiQuery<ProjectChatUnreadSummary[]>(
    activeWorkspace ? `/workspaces/${activeWorkspace.id}/chat/unread` : null,
  );
  const currentProject = isProjectRoute
    ? projects.data?.find((p) => p.id === params.id)
    : undefined;
  const reloadProjects = projects.reload;
  const reloadChatUnread = chatUnread.reload;
  useRealtimeRefresh(isProjectEvent, reloadProjects);
  useRealtimeRefresh((e) => e.type.startsWith('chat.'), reloadChatUnread);
  const shellData = useMemo(() => ({ reloadChatUnread }), [reloadChatUnread]);

  // The drawer is open only for the page it was opened on, so navigating closes it.
  const drawerOpen = !isDesktop && drawerPath === pathname;
  const closeDrawer = () => setDrawerPath(null);

  // Workspace search (record 0017): Ctrl+K or ⌘K anywhere in a workspace.
  const [searchOpen, setSearchOpen] = useState(false);
  // `?` lists every keyboard shortcut.
  const [helpOpen, setHelpOpen] = useState(false);
  useShortcuts([{ key: '?', run: () => setHelpOpen(true) }]);
  const canSearch = Boolean(activeWorkspace);
  const openSearch = () => {
    closeDrawer();
    setSearchOpen(true);
  };
  useEffect(() => {
    if (!canSearch) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDrawerPath(null);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSearch]);

  const sidebar = (showBell: boolean) => (
    <Sidebar
      user={user}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      projects={projects.data ?? []}
      chatUnread={chatUnread.data ?? []}
      currentProjectId={isProjectRoute ? (params.id ?? null) : null}
      onLogout={() => signOut(router)}
      onNavigate={closeDrawer}
      showBell={showBell}
      onSearch={openSearch}
      onCollapse={isDesktop ? () => setSidebarCollapsed(true) : undefined}
    />
  );

  const content = (
    <div
      className={
        isMobileChat ? 'flex min-h-0 flex-1 flex-col px-2 py-2' : 'px-4 py-6 sm:px-7 lg:py-8'
      }
    >
      <div className={isMobileChat ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-6'}>
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
      {pathname === '/' && isDesktop ? (
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
          <ActiveTimerBar />
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
          {sidebarCollapsed ? (
            // A slim rail keeps the way back, search and notifications in reach.
            <nav
              aria-label="Primary"
              className="flex w-13 shrink-0 flex-col items-center gap-1 py-3"
            >
              <IconButton
                aria-label="Show sidebar"
                title="Show sidebar"
                onClick={() => setSidebarCollapsed(false)}
              >
                <SidebarIcon size={16} />
              </IconButton>
              {canSearch ? (
                <IconButton aria-label="Search" title="Search (Ctrl K)" onClick={openSearch}>
                  <SearchIcon size={16} />
                </IconButton>
              ) : null}
              <NotificationBell />
              <RailProjects
                projects={projects.data ?? []}
                currentProjectId={isProjectRoute ? (params.id ?? null) : null}
              />
            </nav>
          ) : (
            <aside className="w-62 shrink-0">{sidebar(true)}</aside>
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className="relative my-2 mr-2 min-w-0 flex-1 overflow-y-auto rounded-panel border border-line bg-surface focus-visible:shadow-none"
          >
            <div className="sticky top-0 z-10">
              <ActiveTimerBar />
            </div>
            {content}
          </main>
        </div>
      ) : (
        <div className="flex h-dvh flex-col bg-surface">
          <header className="shrink-0 border-b border-line pt-[env(safe-area-inset-top)]">
            <div className="flex h-14 items-center gap-3 px-4">
              <Link
                href="/"
                aria-label="DevTrack home"
                className="grid size-11 place-items-center rounded-control"
              >
                <DevtrackMark size={26} />
              </Link>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {projectQuery.data?.project.name ?? activeWorkspace?.name ?? 'DevTrack'}
              </span>
              {canSearch ? (
                <IconButton aria-label="Search" onClick={openSearch}>
                  <SearchIcon size={18} />
                </IconButton>
              ) : null}
              <NotificationBell />
            </div>
          </header>
          <ActiveTimerBar />
          <main
            id="main-content"
            tabIndex={-1}
            className={`relative min-h-0 flex-1 overflow-y-auto focus-visible:shadow-none ${isMobileChat ? 'flex flex-col' : ''}`}
          >
            {content}
          </main>
          <MobileNavigation
            pathname={pathname}
            projectId={isProjectRoute ? params.id : undefined}
            workspaceId={activeWorkspaceId}
            unread={chatUnread.data?.find((item) => item.projectId === params.id)?.unreadCount ?? 0}
            menuOpen={drawerOpen}
            onOpenMenu={() => setDrawerPath(pathname)}
          />
          {drawerOpen ? (
            <Drawer onClose={closeDrawer}>
              <div className="flex h-full flex-col">
                {currentProject ? (
                  <ProjectMoreLinks
                    project={currentProject}
                    pathname={pathname}
                    onNavigate={closeDrawer}
                  />
                ) : null}
                <div className="min-h-0 flex-1">{sidebar(false)}</div>
              </div>
            </Drawer>
          ) : null}
        </div>
      )}
      {helpOpen ? <ShortcutsHelp onClose={() => setHelpOpen(false)} /> : null}
      {searchOpen && activeWorkspace ? (
        <SearchDialog workspaceId={activeWorkspace.id} onClose={() => setSearchOpen(false)} />
      ) : null}
    </ShellDataContext.Provider>
  );
}

function MobileNavigation({
  pathname,
  projectId,
  workspaceId,
  unread,
  menuOpen,
  onOpenMenu,
}: {
  pathname: string;
  projectId?: string;
  workspaceId: string;
  unread: number;
  menuOpen: boolean;
  onOpenMenu: () => void;
}) {
  const base = `/projects/${projectId}`;
  const workspace = `/workspaces/${workspaceId}`;
  const tabs: {
    href: string;
    label: string;
    icon: typeof BoardIcon;
    active: boolean;
    unread?: number;
  }[] = projectId
    ? [
        {
          href: base,
          label: 'Board',
          icon: BoardIcon,
          active: pathname === base || pathname.startsWith(`${base}/tasks/`),
        },
        {
          href: `${base}/list`,
          label: 'List',
          icon: ListIcon,
          active: pathname === `${base}/list`,
        },
        {
          href: `${base}/chat`,
          label: 'Chat',
          icon: ChatIcon,
          active: pathname === `${base}/chat`,
          unread,
        },
        {
          href: `${base}/timesheet`,
          label: 'Timesheet',
          icon: CalendarIcon,
          active: pathname === `${base}/timesheet`,
        },
      ]
    : [
        {
          href: workspaceId ? workspace : '/',
          label: 'Projects',
          icon: FolderIcon,
          active:
            pathname === '/' || pathname === workspace || pathname === `${workspace}/projects`,
        },
        ...(workspaceId
          ? [
              {
                href: `${workspace}/my-tasks`,
                label: 'My tasks',
                icon: MyTasksIcon,
                active: pathname === `${workspace}/my-tasks`,
              },
            ]
          : []),
      ];
  const itemClass = (active: boolean) =>
    `relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-control text-xs font-medium transition-colors ${active ? 'bg-primary-soft text-primary-soft-fg' : 'text-fg-secondary hover:bg-surface-muted'}`;
  return (
    <nav
      aria-label="Quick navigation"
      className="flex shrink-0 gap-1 border-t border-line bg-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
    >
      {tabs.map(({ href, label, icon: Icon, active, unread: count }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? 'page' : undefined}
          className={itemClass(active)}
        >
          <span className="relative">
            <Icon size={18} />
            {count ? (
              <span
                aria-label={`${count} unread messages`}
                className="absolute -top-1 -right-2.5 rounded-full bg-primary px-1 text-xs leading-tight text-fg-on-inverse"
              >
                {count > 9 ? '9+' : count}
              </span>
            ) : null}
          </span>
          {label}
        </Link>
      ))}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
        className={itemClass(menuOpen)}
      >
        <MoreIcon size={18} />
        More
      </button>
    </nav>
  );
}

/**
 * The project views that don't fit in the bottom bar, shown first in "More"
 * so they aren't buried in the full sidebar.
 */
function ProjectMoreLinks({
  project,
  pathname,
  onNavigate,
}: {
  project: Project;
  pathname: string;
  onNavigate: () => void;
}) {
  const base = `/projects/${project.id}`;
  const links = [
    { href: `${base}/milestones`, label: 'Milestones', icon: FlagIcon },
    { href: `${base}/activity`, label: 'Activity', icon: ActivityIcon },
    ...(project.status === 'ARCHIVED' || !(project.viewerCanTriage || project.viewerMustPropose)
      ? []
      : [
          {
            href: `${base}/triage`,
            label: project.viewerCanTriage ? 'Triage' : 'Proposals',
            icon: InboxIcon,
            count: project.viewerCanTriage ? project.newRequestCount : undefined,
          },
        ]),
    project.viewerCanManage
      ? { href: `${base}/settings`, label: 'Settings', icon: SettingsIcon }
      : { href: `${base}/members`, label: 'Members', icon: UsersIcon },
  ];
  return (
    <section aria-label={`More in ${project.name}`} className="shrink-0 border-b border-line p-3">
      <h3 className="truncate px-1 pb-2 text-xs font-medium text-fg-muted">{project.name}</h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {links.map(({ href, label, icon: Icon, count }) => {
          const active = pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-card border text-label font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary-soft text-primary-soft-fg'
                    : 'border-line bg-surface text-fg-secondary hover:bg-surface-muted'
                }`}
              >
                <Icon size={18} />
                <span>
                  {label}
                  {count ? <span className="sr-only">, {count} new</span> : null}
                </span>
                {count ? (
                  <span
                    aria-hidden="true"
                    className="min-w-4.5 rounded-full bg-primary px-1.5 text-center text-pill leading-4.5 font-semibold text-fg-on-inverse"
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Bottom sheet on a native modal <dialog>: the browser makes the page inert, traps focus,
 * and closes it on Escape or the back gesture. Tapping the dimmed backdrop closes it too.
 */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Layout effect: the cleanup must close the dialog before React removes it,
  // so the browser returns focus to the "More" button.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      // A close queued by an unmount (or StrictMode's re-run) may land after the
      // dialog has reopened; only a dialog that is still closed should close the menu.
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      // Clicks on the ::backdrop target the dialog itself; the sheet's content fills it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="mx-auto mt-auto mb-0 h-[min(80dvh,44rem)] w-full max-w-md overflow-hidden rounded-t-panel bg-bg text-fg shadow-overlay backdrop:bg-fg/40 open:flex open:flex-col"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-1">
        <h2 className="text-sm font-semibold">Navigation</h2>
        <IconButton className="size-11" aria-label="Close navigation" onClick={onClose}>
          <XIcon size={18} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">{children}</div>
    </dialog>
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

/**
 * Shown while the session loads (a cold start can take a few seconds): the app's outline
 * instead of a bare "Loading…", so the page doesn't jump when it arrives. Pure CSS
 * breakpoints, since the desktop/phone choice isn't known before hydration.
 */
function ShellSkeleton() {
  return (
    <div role="status" className="flex h-dvh bg-bg">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="hidden w-62 shrink-0 flex-col gap-2 px-2.5 py-3 lg:flex">
        <div className="flex h-10 items-center gap-2.5 px-1.5">
          <DevtrackMark size={24} />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="mt-3 h-8" />
        <Skeleton className="mt-4 h-3 w-16" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <div
        aria-hidden="true"
        className="flex min-w-0 flex-1 flex-col bg-surface lg:my-2 lg:mr-2 lg:rounded-panel lg:border lg:border-line"
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 lg:hidden">
          <DevtrackMark size={26} />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-4 px-4 py-6 sm:px-7 lg:pt-8">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-8 w-56" />
          <div className="grid-cols-cards grid gap-4 pt-4">
            <Skeleton className="h-40 rounded-card" />
            <Skeleton className="h-40 rounded-card" />
            <Skeleton className="hidden h-40 rounded-card sm:block" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Folded sidebar: projects as letter icons (favourites first) so switching stays one click. */
function RailProjects({
  projects,
  currentProjectId,
}: {
  projects: Project[];
  currentProjectId: string | null;
}) {
  const favorites = useFavoriteProjects();
  if (projects.length === 0) return null;
  const ordered = [
    ...favorites.map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => !!p),
    ...projects.filter((p) => !favorites.includes(p.id)),
  ];
  return (
    <ul
      aria-label="Projects"
      className="mt-2 flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-t border-line pt-2 scrollbar-none"
    >
      {ordered.map((p) => (
        <li key={p.id}>
          <Link
            href={`/projects/${p.id}`}
            title={p.name}
            aria-label={p.name}
            aria-current={p.id === currentProjectId ? 'page' : undefined}
            className={`touch-target flex size-8 items-center justify-center rounded-control transition-colors hover:bg-surface-muted ${
              p.id === currentProjectId ? 'bg-primary-soft' : ''
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex size-5 items-center justify-center rounded-chip text-xs font-semibold uppercase ${avatarTone(p.id)}`}
            >
              {p.name.slice(0, 1)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

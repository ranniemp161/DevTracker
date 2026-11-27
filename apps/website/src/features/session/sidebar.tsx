'use client';

import type {
  Project,
  ProjectChatUnreadSummary,
  PublicUser,
  WorkspaceSummary,
} from '@devtrack/types';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ActivityIcon,
  BoardIcon,
  CalendarIcon,
  ChatIcon,
  ChevronRightIcon,
  ChevronUpDownIcon,
  DevtrackMark,
  FlagIcon,
  FolderIcon,
  InboxIcon,
  LinkIcon,
  MyTasksIcon,
  ListIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  StarIcon,
  UsersIcon,
} from '@/components/icons';
import { Menu, MenuGroup, MenuItem, MenuLink, MenuSeparator } from '@/components/menu';
import { api, ApiError } from '@/lib/api';
import { useSession } from './session-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Avatar, avatarTone } from '@/components/ui';
import { CHOOSE_WORKSPACE_PARAM } from '@/lib/last-workspace';
import {
  setProjectExpanded,
  toggleFavoriteProject,
  useExpandedProjects,
  useFavoriteProjects,
} from '@/lib/project-prefs';
import { applyThemeChoice, readThemeChoice, THEME_CHOICES, type ThemeChoice } from '@/lib/theme';
import { NotificationBell } from '../collaboration/notification-bell';
import { isAdmin, ROLE_LABEL } from '../workspaces/permissions';

const navItemBase = 'flex items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors';
const navItemIdle = 'text-fg-secondary hover:bg-surface-muted';
const navItemActive = 'bg-primary-soft font-medium text-primary-soft-fg';

function NavLink({
  href,
  active,
  icon,
  children,
  trailing,
  compact = false,
  onNavigate,
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`${navItemBase} ${compact ? 'h-8' : 'h-8.5'} pointer-coarse:h-11 ${active ? navItemActive : navItemIdle}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Link>
  );
}

export interface SidebarProps {
  user: PublicUser;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  projects: Project[];
  chatUnread: ProjectChatUnreadSummary[];
  currentProjectId: string | null;
  onLogout: () => void;
  /** Closes the mobile drawer after a navigation. */
  onNavigate?: () => void;
  /** Desktop shows the bell next to the switcher; the mobile top bar owns it otherwise. */
  showBell: boolean;
  /** Opens workspace search (record 0017). */
  onSearch: () => void;
  /** Desktop only: hides the sidebar to give the page more room. */
  onCollapse?: () => void;
}

export function Sidebar({
  user,
  workspaces,
  activeWorkspaceId,
  projects,
  chatUnread,
  currentProjectId,
  onLogout,
  onNavigate,
  showBell,
  onSearch,
  onCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const base = active ? `/workspaces/${active.id}` : null;

  return (
    <nav aria-label="Primary" className="flex h-full min-h-0 flex-col gap-4 px-2.5 py-3">
      <div className="flex items-center gap-1">
        <WorkspaceSwitcher workspaces={workspaces} active={active} onNavigate={onNavigate} />
        {showBell ? <NotificationBell /> : null}
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            className="touch-target inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
          >
            <SidebarIcon size={16} />
          </button>
        ) : null}
      </div>

      {active ? (
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="mb-3 space-y-0.5">
            <button
              type="button"
              onClick={onSearch}
              aria-keyshortcuts="Control+K Meta+K"
              className={`${navItemBase} mb-2 h-8.5 w-full border border-line bg-surface text-fg-muted hover:bg-surface-muted pointer-coarse:h-11`}
            >
              <SearchIcon size={16} />
              <span className="flex-1 text-left">Search</span>
              <ShortcutHint />
            </button>
            {/* 0027 §3: admins and project leads only. */}
            {active.viewerCanSeeOverview ? (
              <NavLink
                href={`${base}/overview`}
                active={pathname === `${base}/overview`}
                icon={<FlagIcon size={16} />}
                onNavigate={onNavigate}
              >
                Overview
              </NavLink>
            ) : null}
            <NavLink
              href={`${base}/my-tasks`}
              active={pathname === `${base}/my-tasks`}
              icon={<MyTasksIcon size={16} />}
              onNavigate={onNavigate}
            >
              My tasks
            </NavLink>
          </div>
          <div className="flex h-7 items-center justify-between px-2.5">
            <h2 className="text-xs font-medium text-fg-muted">Projects</h2>
            {isAdmin(active.role) ? (
              <Link
                href={`${base}/projects/new`}
                onClick={onNavigate}
                aria-label="New project"
                className="touch-target inline-flex size-6.5 items-center justify-center rounded-chip text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
              >
                <PlusIcon size={14} />
              </Link>
            ) : null}
          </div>
          <ProjectList
            projects={projects}
            chatUnread={chatUnread}
            currentProjectId={currentProjectId}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {base && active ? (
        <div className="space-y-0.5">
          <NavLink
            href={`${base}/projects`}
            active={pathname === `${base}/projects` || pathname === base}
            icon={<FolderIcon size={16} />}
            onNavigate={onNavigate}
          >
            All projects
          </NavLink>
          <NavLink
            href={`${base}/members`}
            active={pathname.startsWith(`${base}/members`)}
            icon={<UsersIcon size={16} />}
            onNavigate={onNavigate}
          >
            Members
          </NavLink>
          {isAdmin(active.role) ? (
            <NavLink
              href={`${base}/settings`}
              active={pathname.startsWith(`${base}/settings`)}
              icon={<SettingsIcon size={16} />}
              onNavigate={onNavigate}
            >
              Workspace settings
            </NavLink>
          ) : null}
        </div>
      ) : null}

      <UserRow user={user} onLogout={onLogout} />
    </nav>
  );
}

/** Workspace switcher (SPEC §5): logo, current workspace and up/down chevrons, opening a menu. */
function WorkspaceSwitcher({
  workspaces,
  active,
  onNavigate,
}: {
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary | undefined;
  onNavigate?: () => void;
}) {
  return (
    <Menu
      label="Switch workspace"
      triggerProps={{ title: active?.name }}
      triggerClassName="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 text-left transition-colors hover:bg-surface-muted aria-expanded:bg-surface-muted"
      menuClassName="w-72"
      trigger={
        <>
          <DevtrackMark size={24} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
            {active?.name ?? 'All workspaces'}
          </span>
          <ChevronUpDownIcon size={16} className="shrink-0 text-fg-subtle" />
        </>
      }
    >
      <MenuGroup label="Workspaces">
        {workspaces.map((w) => (
          <MenuLink
            key={w.id}
            href={`/workspaces/${w.id}`}
            current={w.id === active?.id}
            onNavigate={onNavigate}
            icon={
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-control text-xs font-semibold uppercase ${avatarTone(w.id)}`}
              >
                {Array.from(w.name.trim())[0] ?? 'W'}
              </span>
            }
          >
            <span className="block text-sm font-medium text-fg">{w.name}</span>
            <span className="block text-xs text-fg-muted">{ROLE_LABEL[w.role]}</span>
          </MenuLink>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuLink
        href={`/?${CHOOSE_WORKSPACE_PARAM}`}
        onNavigate={onNavigate}
        icon={<FolderIcon size={16} />}
      >
        All workspaces
      </MenuLink>
      <MenuLink href="/workspaces/new" onNavigate={onNavigate} icon={<PlusIcon size={16} />}>
        New workspace
      </MenuLink>
    </Menu>
  );
}

function ProjectSubNav({
  id,
  project,
  pathname,
  unread,
  onNavigate,
}: {
  id: string;
  project: Project;
  pathname: string;
  unread: number;
  onNavigate?: () => void;
}) {
  const searchStr = useSearchParams().toString();
  const base = `/projects/${project.id}`;
  const items = [
    { href: base, label: 'Board', icon: <BoardIcon size={16} />, filtered: true },
    { href: `${base}/list`, label: 'List', icon: <ListIcon size={16} />, filtered: true },
    { href: `${base}/chat`, label: 'Chat', icon: <ChatIcon size={16} />, count: unread },
    { href: `${base}/milestones`, label: 'Milestones', icon: <FlagIcon size={16} /> },
    { href: `${base}/timesheet`, label: 'Timesheet', icon: <CalendarIcon size={16} /> },
    { href: `${base}/activity`, label: 'Activity', icon: <ActivityIcon size={16} /> },
    // Request form triage (0016); hidden on archived projects and from members who don't triage (0023 §4).
    ...(project.status === 'ARCHIVED' || !(project.viewerCanTriage || project.viewerMustPropose)
      ? []
      : [
          {
            href: `${base}/triage`,
            label: project.viewerCanTriage ? 'Triage' : 'Proposals',
            icon: <InboxIcon size={16} />,
            count: project.viewerCanTriage ? project.newRequestCount : undefined,
          },
        ]),
    // Members stay reachable for everyone; admins get the full settings page.
    ...(project.viewerCanManage
      ? [{ href: `${base}/settings`, label: 'Settings', icon: <SettingsIcon size={16} /> }]
      : [{ href: `${base}/members`, label: 'Members', icon: <UsersIcon size={16} /> }]),
  ];

  const isActive = (href: string) =>
    href === base ? pathname === base : pathname.startsWith(href);
  // Board, List and Chat stay in view; Triage joins them while requests wait.
  const primary = items.filter(
    (i) =>
      i.label === 'Board' ||
      i.label === 'List' ||
      i.label === 'Chat' ||
      (i.label === 'Triage' && (i.count ?? 0) > 0),
  );
  const more = items.filter((i) => !primary.includes(i));
  const moreActive = more.some((i) => isActive(i.href));
  const link = (item: (typeof items)[number]) => {
    const href = item.filtered && searchStr ? `${item.href}?${searchStr}` : item.href;
    return (
      <li key={item.href}>
        <NavLink
          href={href}
          active={isActive(item.href)}
          icon={item.icon}
          compact
          onNavigate={onNavigate}
          trailing={
            item.count && item.count > 0 ? (
              <span className="min-w-4.5 rounded-full bg-primary px-1.5 text-center text-pill leading-4.5 font-semibold text-fg-on-inverse">
                {item.count > 99 ? '99+' : item.count}
              </span>
            ) : null
          }
        >
          {item.label}
        </NavLink>
      </li>
    );
  };

  return (
    <ul
      id={id}
      aria-label={`${project.name} navigation`}
      className="mt-0.5 mb-1 ml-4 space-y-0.5 border-l border-line pl-2"
    >
      {primary.map(link)}
      <li>
        {/* The rest of the project's pages; open while one of them is the current page. */}
        <details className="group" open={moreActive || undefined}>
          <summary
            className={`${navItemBase} ${navItemIdle} h-8 cursor-pointer list-none text-fg-muted pointer-coarse:h-11 [&::-webkit-details-marker]:hidden`}
          >
            <ChevronRightIcon size={16} className="transition-transform group-open:rotate-90" />
            <span className="flex-1">More</span>
          </summary>
          <ul className="mt-0.5 space-y-0.5">{more.map(link)}</ul>
        </details>
      </li>
    </ul>
  );
}

/** Favourites first, then the rest; each project can be folded, with a ⋯ menu. */
function ProjectList({
  projects,
  chatUnread,
  currentProjectId,
  pathname,
  onNavigate,
}: {
  projects: Project[];
  chatUnread: ProjectChatUnreadSummary[];
  currentProjectId: string | null;
  pathname: string;
  onNavigate?: () => void;
}) {
  const favoriteIds = useFavoriteProjects();
  const favorites = favoriteIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is Project => Boolean(p));
  const others = projects.filter((p) => !favoriteIds.includes(p.id));
  const row = (p: Project) => (
    <ProjectRow
      key={p.id}
      project={p}
      favorite={favoriteIds.includes(p.id)}
      current={p.id === currentProjectId}
      pathname={pathname}
      unread={chatUnread.find((u) => u.projectId === p.id)?.unreadCount ?? 0}
      onNavigate={onNavigate}
    />
  );
  return (
    <>
      {favorites.length > 0 ? (
        <>
          <h3 className="mt-1 px-2.5 py-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
            Favourites
          </h3>
          <ul className="space-y-0.5">{favorites.map(row)}</ul>
          {others.length > 0 ? (
            <h3 className="mt-2 px-2.5 py-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">
              All projects
            </h3>
          ) : null}
        </>
      ) : null}
      <ul className="mt-1 space-y-0.5">{others.map(row)}</ul>
    </>
  );
}

function ProjectRow({
  project,
  favorite,
  current,
  pathname,
  unread,
  onNavigate,
}: {
  project: Project;
  favorite: boolean;
  current: boolean;
  pathname: string;
  unread: number;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const choices = useExpandedProjects();
  const subNavId = useId();
  // The open project starts expanded; any project can be folded or unfolded and is remembered.
  const expanded = choices[project.id] ?? current;
  const attention = unread + (project.status === 'ARCHIVED' ? 0 : project.newRequestCount);
  const base = `/projects/${project.id}`;
  const [copied, setCopied] = useState(false);

  return (
    <li>
      <div className="group/row relative flex items-center">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={subNavId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          onClick={() => setProjectExpanded(project.id, !expanded)}
          className="touch-target absolute left-0.5 z-10 inline-flex size-5 items-center justify-center rounded-chip text-fg-subtle opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-fg focus-visible:opacity-100 pointer-coarse:opacity-100"
        >
          <ChevronRightIcon size={12} className={expanded ? 'rotate-90' : ''} />
        </button>
        <div className="min-w-0 flex-1">
          <NavLink
            href={base}
            active={current && pathname === base}
            onNavigate={onNavigate}
            icon={
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center rounded-chip text-2xs font-semibold uppercase ${avatarTone(project.id)}`}
              >
                {project.name.slice(0, 1)}
              </span>
            }
            trailing={
              !expanded && attention > 0 ? (
                <span className="min-w-4.5 rounded-full bg-primary px-1.5 text-center text-pill leading-4.5 font-semibold text-fg-on-inverse">
                  <span className="sr-only">Needs attention: </span>
                  {attention > 99 ? '99+' : attention}
                </span>
              ) : (
                <span className="font-mono text-xs font-normal text-fg-subtle group-hover/row:invisible pointer-coarse:invisible">
                  {project.key}
                </span>
              )
            }
          >
            {project.name}
          </NavLink>
        </div>
        <Menu
          label={`${project.name} actions`}
          align="end"
          triggerProps={{ 'aria-label': `${project.name} actions` }}
          triggerClassName="touch-target absolute right-1 inline-flex size-6.5 items-center justify-center rounded-chip text-fg-muted opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-surface-muted hover:text-fg focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
          menuClassName="w-48"
          trigger={<MoreIcon size={14} />}
        >
          {project.status === 'ARCHIVED' ? null : (
            <MenuItem
              icon={<PlusIcon size={14} />}
              onSelect={() => {
                onNavigate?.();
                router.push(`${base}?new=1`);
              }}
            >
              {project.viewerMustPropose ? 'Propose task' : 'New task'}
            </MenuItem>
          )}
          <MenuItem
            icon={<StarIcon size={14} filled={favorite} />}
            onSelect={() => toggleFavoriteProject(project.id)}
          >
            {favorite ? 'Remove from favourites' : 'Add to favourites'}
          </MenuItem>
          <MenuItem
            icon={<LinkIcon size={14} />}
            onSelect={() => {
              void navigator.clipboard
                ?.writeText(new URL(base, window.location.origin).toString())
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
            }}
          >
            Copy link
          </MenuItem>
          {project.viewerCanManage ? (
            <MenuLink
              href={`${base}/settings`}
              icon={<SettingsIcon size={14} />}
              onNavigate={onNavigate}
            >
              Settings
            </MenuLink>
          ) : null}
        </Menu>
        <span role="status" className="sr-only">
          {copied ? 'Link copied' : ''}
        </span>
      </div>
      {expanded ? (
        <Suspense fallback={null}>
          <ProjectSubNav
            id={subNavId}
            project={project}
            pathname={pathname}
            unread={unread}
            onNavigate={onNavigate}
          />
        </Suspense>
      ) : null}
    </li>
  );
}

function UserRow({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  // The choice lives in localStorage, which the server can't see: read it on the client.
  // The sidebar renders only in the browser (after the session loads), so this is safe.
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [editingTitle, setEditingTitle] = useState(false);

  return (
    <div className="flex items-center gap-2.5 border-t border-line px-2 pt-3">
      <Avatar name={user.username} url={user.avatarUrl} seed={user.id} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg-secondary">@{user.username}</span>
        {user.jobTitle ? (
          <span className="block truncate text-xs text-fg-muted">{user.jobTitle}</span>
        ) : null}
      </span>
      <Menu
        label="Account"
        align="end"
        triggerProps={{ 'aria-label': 'Account menu' }}
        triggerClassName="touch-target inline-flex size-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg aria-expanded:bg-surface-muted"
        trigger={<MoreIcon size={16} />}
      >
        <MenuGroup label="Theme">
          {THEME_CHOICES.map((c) => (
            <MenuItem
              key={c.value}
              checked={theme === c.value}
              onSelect={() => {
                applyThemeChoice(c.value);
                setTheme(c.value);
              }}
            >
              {c.label}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onSelect={() => setEditingTitle(true)}>Job title…</MenuItem>
        <MenuItem onSelect={onLogout}>Sign out</MenuItem>
      </Menu>
      {editingTitle ? (
        <JobTitleDialog current={user.jobTitle} onClose={() => setEditingTitle(false)} />
      ) : null}
    </div>
  );
}

/** Sets or clears the display-only job title (decision record 0023 §7). */
function JobTitleDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const { reloadUser } = useSession();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function save() {
    setError(null);
    try {
      await api('/auth/me', { method: 'PATCH', body: { jobTitle: value } });
      reloadUser();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your job title.');
    }
  }

  return (
    <ConfirmDialog
      open
      title="Job title"
      tone="primary"
      confirmLabel="Save"
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <label htmlFor={inputId} className="mb-1.5 block text-sm text-fg-secondary">
        Shown next to your name, for example &ldquo;Engineering manager&rdquo;. It doesn&apos;t
        change what you can do. Leave it empty to remove it.
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={80}
        className="h-9 w-full rounded-control border border-line-control bg-surface px-2.5 text-sm focus-visible:border-primary"
      />
      {error ? <p className="mt-1.5 text-sm text-danger">{error}</p> : null}
    </ConfirmDialog>
  );
}

const noSubscribe = () => () => {};

/** "⌘K" on Apple devices, "Ctrl K" elsewhere; hidden on touch screens without a keyboard. */
function ShortcutHint() {
  // The platform is unknown while rendering on the server, so the hint appears after hydration.
  const apple = useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => null,
  );
  if (apple === null) return null;
  return (
    <kbd className="rounded-kbd border border-line px-1.5 text-2xs text-fg-muted pointer-coarse:hidden">
      {apple ? '⌘K' : 'Ctrl K'}
    </kbd>
  );
}

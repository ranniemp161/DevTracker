'use client';

import type {
  Project,
  ProjectChatUnreadSummary,
  PublicUser,
  WorkspaceSummary,
} from '@devtrack/types';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIcon,
  BoardIcon,
  ChatIcon,
  ChevronDownIcon,
  DevtrackMark,
  FlagIcon,
  FolderIcon,
  ListIcon,
  MoreIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from '@/components/icons';
import { Avatar, avatarTone, IconButton } from '@/components/ui';
import { NotificationBell } from '../collaboration/notification-bell';
import { isAdmin } from '../workspaces/permissions';

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
      className={`${navItemBase} ${compact ? 'h-8' : 'h-8.5'} ${active ? navItemActive : navItemIdle}`}
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
  onWorkspaceChange: (workspaceId: string) => void;
  onLogout: () => void;
  /** Closes the mobile drawer after a navigation. */
  onNavigate?: () => void;
  /** Desktop shows the bell next to the switcher; the mobile top bar owns it otherwise. */
  showBell: boolean;
}

export function Sidebar({
  user,
  workspaces,
  activeWorkspaceId,
  projects,
  chatUnread,
  currentProjectId,
  onWorkspaceChange,
  onLogout,
  onNavigate,
  showBell,
}: SidebarProps) {
  const pathname = usePathname();
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const base = active ? `/workspaces/${active.id}` : null;

  return (
    <nav aria-label="Primary" className="flex h-full min-h-0 flex-col gap-4 px-2.5 py-3">
      <div className="flex items-center gap-1">
        <label className="relative flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 hover:bg-surface-muted focus-within:bg-surface-muted">
          <DevtrackMark size={24} />
          <span className="sr-only">Workspace</span>
          <select
            value={active ? active.id : ''}
            onChange={(e) => onWorkspaceChange(e.target.value)}
            className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-semibold text-fg focus-visible:shadow-none"
          >
            <option value="">All workspaces</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <ChevronDownIcon
            size={14}
            className="pointer-events-none absolute right-2 text-fg-subtle"
          />
        </label>
        {showBell ? <NotificationBell /> : null}
      </div>

      {active ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex h-7 items-center justify-between px-2.5">
            <h2 className="text-xs font-medium text-fg-muted">Projects</h2>
            {isAdmin(active.role) ? (
              <Link
                href={`${base}/projects/new`}
                onClick={onNavigate}
                aria-label="New project"
                className="inline-flex size-6.5 items-center justify-center rounded-chip text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
              >
                <PlusIcon size={14} />
              </Link>
            ) : null}
          </div>
          <ul className="mt-1 space-y-0.5">
            {projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              return (
                <li key={p.id}>
                  <NavLink
                    href={`/projects/${p.id}`}
                    active={isCurrent && pathname === `/projects/${p.id}`}
                    onNavigate={onNavigate}
                    icon={
                      <span
                        aria-hidden="true"
                        className={`flex size-4 shrink-0 items-center justify-center rounded-chip text-2xs font-semibold uppercase ${avatarTone(p.id)}`}
                      >
                        {p.name.slice(0, 1)}
                      </span>
                    }
                    trailing={
                      <span className="font-mono text-xs font-normal text-fg-subtle">{p.key}</span>
                    }
                  >
                    {p.name}
                  </NavLink>
                  {isCurrent ? (
                    <Suspense fallback={null}>
                      <ProjectSubNav
                        project={p}
                        pathname={pathname}
                        unread={chatUnread.find((u) => u.projectId === p.id)?.unreadCount ?? 0}
                        onNavigate={onNavigate}
                      />
                    </Suspense>
                  ) : null}
                </li>
              );
            })}
          </ul>
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

function ProjectSubNav({
  project,
  pathname,
  unread,
  onNavigate,
}: {
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
    { href: `${base}/activity`, label: 'Activity', icon: <ActivityIcon size={16} /> },
    // Members stay reachable for everyone; admins get the full settings page.
    ...(project.viewerCanManage
      ? [{ href: `${base}/settings`, label: 'Settings', icon: <SettingsIcon size={16} /> }]
      : [{ href: `${base}/members`, label: 'Members', icon: <UsersIcon size={16} /> }]),
  ];

  return (
    <ul
      aria-label={`${project.name} navigation`}
      className="mt-0.5 mb-1 ml-4 space-y-0.5 border-l border-line pl-2"
    >
      {items.map((item) => {
        const isActive = item.href === base ? pathname === base : pathname.startsWith(item.href);
        const href = item.filtered && searchStr ? `${item.href}?${searchStr}` : item.href;
        return (
          <li key={item.href}>
            <NavLink
              href={href}
              active={isActive}
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
      })}
    </ul>
  );
}

function UserRow({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex items-center gap-2.5 border-t border-line px-2 pt-3">
      <Avatar name={user.username} url={user.avatarUrl} seed={user.id} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">@{user.username}</span>
      <IconButton
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon size={16} />
      </IconButton>
      {open ? (
        <div
          role="menu"
          className="absolute right-2 bottom-full z-30 mb-1 w-40 rounded-card border border-line bg-surface p-1 shadow-overlay"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className="flex h-8 w-full items-center rounded-control px-2.5 text-left text-sm text-fg-secondary hover:bg-surface-muted"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

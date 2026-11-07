'use client';

import type { Notification } from '@devtrack/types';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { api, apiPage } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { timeAgo } from './describe-activity';

export function NotificationBell({ align = 'start' }: { align?: 'start' | 'end' }) {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    api<{ count: number }>('/notifications/unread-count').then(
      (r) => setCount(r.count),
      () => undefined, // transient failures are fine; the next event or navigation retries
    );
  }, []);

  // Refreshed on navigation, on every notification event for this user (M7), and after a
  // reconnect. No polling.
  useEffect(() => {
    refreshCount();
  }, [refreshCount, pathname]);
  useRealtimeRefresh((e) => e.type.startsWith('notification.'), refreshCount);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiPage<Notification>('/notifications?limit=15').then(
      (page) => !cancelled && setItems(page.items),
      () => !cancelled && setItems([]),
    );
    const onClick = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openNotification(n: Notification) {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
      refreshCount();
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
    setItems(
      (list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null,
    );
    refreshCount();
  }

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative inline-flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-2xs leading-4 font-semibold text-fg-on-inverse">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className={`fixed inset-x-4 top-14 z-30 rounded-card border border-line bg-surface shadow-overlay sm:absolute sm:inset-x-auto sm:top-full sm:mt-2 sm:w-80 ${align === 'end' ? 'sm:right-0' : 'sm:left-0'}`}
        >
          <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <Button size="sm" variant="ghost" onClick={markAll} disabled={count === 0}>
              Mark all read
            </Button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!items ? <li className="px-3 py-4 text-sm text-fg-subtle">Loading…</li> : null}
            {items?.length === 0 ? (
              <li className="px-3 py-4 text-sm text-fg-subtle">You are all caught up.</li>
            ) : null}
            {items?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`block w-full px-3 py-2.5 text-left hover:bg-surface-sunken ${n.readAt ? '' : 'bg-status-progress-bg'}`}
                >
                  <span className="flex items-start gap-2">
                    {!n.readAt ? (
                      <span
                        aria-label="Unread"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-status-progress"
                      />
                    ) : null}
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">{n.title}</span>
                      {n.body ? (
                        <span className="block truncate text-xs text-fg-muted">{n.body}</span>
                      ) : null}
                      <span className="block text-xs text-fg-subtle">{timeAgo(n.createdAt)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

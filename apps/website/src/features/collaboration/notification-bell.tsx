'use client';

import type { Notification } from '@devtrack/types';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { placeBelow, supportsAnchoring, supportsInvokers } from '@/components/menu';
import { Button } from '@/components/ui';
import { api, ApiError, apiPage } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { timeAgo } from './describe-activity';

export function NotificationBell({ align = 'start' }: { align?: 'start' | 'end' }) {
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

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

  // The panel is a popover="auto": the browser handles outside clicks and Escape.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen && !supportsAnchoring() && trigger.current) {
        placeBelow(trigger.current, el, align);
      }
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [align]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiPage<Notification>('/notifications?limit=15').then(
      (page) => !cancelled && setItems(page.items),
      () => !cancelled && setItems([]),
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  function togglePanel(e: React.MouseEvent<HTMLButtonElement>) {
    if (supportsInvokers()) return; // the command invoker toggles it natively
    const el = panel.current;
    if (!el) return;
    if (el.matches(':popover-open')) el.hidePopover();
    else
      (el.showPopover as (options?: { source?: HTMLElement }) => void)({ source: e.currentTarget });
  }

  async function openNotification(n: Notification) {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
      refreshCount();
    }
    trigger.current?.focus({ focusVisible: false } as FocusOptions);
    panel.current?.hidePopover();
    if (n.link) router.push(n.link);
  }

  /** "Mark done" on a merge prompt (0021 §4): the API closes the prompt and reads the notice. */
  const [marking, setMarking] = useState<string | null>(null);
  async function markDone(n: Notification) {
    setMarking(n.id);
    let message: string | null = null;
    try {
      await api(`/tasks/${n.resourceId}/done-prompts/accept`, { method: 'POST' });
    } catch (err) {
      message = err instanceof ApiError ? err.message : 'Could not mark the task done.';
      await api(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    }
    setItems(
      (list) =>
        list?.map((item) =>
          item.id === n.id
            ? { ...item, readAt: new Date().toISOString(), body: message ?? 'Marked done.' }
            : item,
        ) ?? null,
    );
    setMarking(null);
    refreshCount();
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => undefined);
    setItems(
      (list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null,
    );
    refreshCount();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        {...({ commandfor: panelId, command: 'toggle-popover' } as Record<string, string>)}
        onClick={togglePanel}
        aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        className="touch-target inline-flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
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
      {/* Right after its trigger; anchored below it and flipped near the viewport edges. */}
      <div
        ref={panel}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-labelledby={titleId}
        className={`anchored-popover ${align === 'end' ? 'anchored-popover-end' : ''} w-80 rounded-card border border-line bg-surface text-fg shadow-overlay`}
      >
        <div className="flex items-center justify-between border-b border-line-subtle px-3 py-2">
          <h2 id={titleId} className="text-sm font-semibold">
            Notifications
          </h2>
          <Button size="sm" variant="ghost" onClick={markAll} disabled={count === 0}>
            Mark all read
          </Button>
        </div>
        <ul>
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
              {n.type === 'TASK_DONE_PROMPT' && !n.readAt ? (
                <div className="bg-status-progress-bg px-3 pb-2.5 pl-7">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={marking === n.id}
                    onClick={() => markDone(n)}
                  >
                    Mark done
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';

type Mode = 'off' | 'mentions' | 'all';
type Settings = { mode: Mode; publicKey: string | null; deviceEnabled: boolean };
const devicePath = '/chat/phone-notifications/device';

export function ChatPhoneNotifications({ projectId }: { projectId: string }) {
  const path = `/projects/${projectId}/chat/phone-notifications`;
  const settings = useApiQuery<Settings>(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Settings>();
  const current = updated ?? settings.data;

  async function save(change: () => Promise<Settings>) {
    setBusy(true);
    setError(null);
    try {
      setUpdated(await change());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update phone notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function enable(current: Settings) {
    if (!current.publicKey) return current;
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setError(
        'On iPhone, add DevTrack to your Home Screen and open it there to enable notifications.',
      );
      return current;
    }
    if ((await Notification.requestPermission()) !== 'granted') {
      setError('Allow notifications in your device or browser settings, then try again.');
      return current;
    }
    await navigator.serviceWorker.register('/chat-push-worker.js');
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: current.publicKey,
      }));
    await api(devicePath, { method: 'PUT', body: subscription.toJSON() });
    return { ...current, deviceEnabled: true };
  }

  async function disable(current: Settings) {
    await api(devicePath, { method: 'DELETE' });
    return { ...current, deviceEnabled: false };
  }

  if (!current?.publicKey) return null;
  return (
    <details className="shrink-0 border-b border-line px-4 py-2">
      <summary className="w-fit cursor-pointer text-sm font-medium text-fg-secondary">
        Phone notifications
      </summary>
      <div className="mt-2 flex flex-wrap items-end gap-3 pb-1">
        <label className="grid min-w-36 gap-1 text-label text-fg-secondary">
          <span>For this project</span>
          <select
            className="h-8 rounded-control border border-line-control bg-surface px-2 text-sm text-fg"
            value={current.mode}
            disabled={busy}
            onChange={(event) => {
              const mode = event.target.value as Mode;
              void save(async () => {
                await api(path, { method: 'PUT', body: { mode } });
                return { ...current, mode };
              });
            }}
          >
            <option value="off">Off</option>
            <option value="mentions">Mentions only</option>
            <option value="all">All new messages</option>
          </select>
        </label>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void save(() => (current.deviceEnabled ? disable(current) : enable(current)))
          }
        >
          {current.deviceEnabled ? 'Disable on this device' : 'Enable on this device'}
        </Button>
      </div>
      {!current.deviceEnabled ? (
        <p className="mt-1 text-label text-fg-subtle">
          On iPhone, add DevTrack to your Home Screen and open it there first.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-label text-danger">
          {error}
        </p>
      ) : null}
    </details>
  );
}

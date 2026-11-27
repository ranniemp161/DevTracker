'use client';

import { useEffect, useState } from 'react';
import { DevtrackMark } from '@/components/icons';
import { Alert, Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/**
 * "Stop emails about this request" (decision record 0028 §2). The token is in the URL fragment,
 * and nothing changes until the person presses the button, so mail scanners that open links
 * can't unsubscribe anyone.
 */
export function StopClientEmails() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken(value ?? '');
  }, []);

  async function stop() {
    if (!token) return;
    setState('sending');
    setError(null);
    try {
      await api('/public/client-emails/stop', { body: { token } });
      setState('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setState('idle');
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-dialog flex-col justify-center gap-6 bg-bg px-4 py-10">
      <div className="space-y-4 rounded-panel border border-line bg-surface p-6 shadow-raised">
        <h1 className="text-lg font-semibold text-fg">Stop emails about this request</h1>
        {token === '' ? (
          <Alert>This link is incomplete. Open it again from the email.</Alert>
        ) : state === 'done' ? (
          <Alert tone="info">Done. You won't get more emails about this request.</Alert>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              You'll stop getting updates about this one request. The team can still see it.
            </p>
            {error ? <Alert>{error}</Alert> : null}
            <Button
              variant="primary"
              loading={state === 'sending'}
              disabled={!token}
              onClick={() => void stop()}
            >
              Stop emails
            </Button>
          </>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <DevtrackMark size={14} /> DevTrack
      </p>
    </main>
  );
}

'use client';

import { useSyncExternalStore } from 'react';

/**
 * Page Visibility helpers. Background tabs must not cost server CPU: the realtime socket and
 * polling loops stop while the tab is hidden and catch up when it is shown again.
 */

type VisibilityDocument = Pick<
  Document,
  'visibilityState' | 'addEventListener' | 'removeEventListener'
>;

/** How long a tab may stay hidden before the realtime connection is closed. */
export const HIDDEN_GRACE_MS = 60_000;

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** True while the tab is visible. Always true during server rendering. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}

/**
 * Calls `onPause` once the page has stayed hidden for `graceMs`, and `onResume` when it is
 * shown again after a pause. Quick tab switches inside the grace period do nothing.
 * Returns the cleanup function.
 */
export function pauseWhileHidden(
  doc: VisibilityDocument,
  graceMs: number,
  onPause: () => void,
  onResume: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const update = () => {
    if (doc.visibilityState === 'hidden') {
      if (paused || timer) return;
      timer = setTimeout(() => {
        timer = null;
        paused = true;
        onPause();
      }, graceMs);
      return;
    }
    clearTimer();
    if (paused) {
      paused = false;
      onResume();
    }
  };
  doc.addEventListener('visibilitychange', update);
  update();
  return () => {
    clearTimer();
    doc.removeEventListener('visibilitychange', update);
  };
}

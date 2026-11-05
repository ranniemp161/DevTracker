'use client';

import { useSyncExternalStore } from 'react';
import { takeTokenFromHash } from '../auth/fragment-token';

/**
 * An invitation link may be opened while signed out. The token is kept in sessionStorage
 * (this tab only) so it survives the detour through sign-in, sign-up and email verification.
 */
const KEY = 'devtrack:pending-invitation';

let listeners: Array<() => void> = [];
let fragmentChecked = false;

function read(): string | null {
  if (!fragmentChecked) {
    fragmentChecked = true;
    const fromLink = takeTokenFromHash();
    if (fromLink) sessionStorage.setItem(KEY, fromLink);
  }
  return sessionStorage.getItem(KEY);
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function clearPendingInvitation(): void {
  sessionStorage.removeItem(KEY);
  for (const l of listeners) l();
}

/**
 * Reads the token from an invitation link (`#token=…`) or from earlier in this tab.
 * `undefined` during server rendering and hydration.
 */
export function usePendingInvitation(): string | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}

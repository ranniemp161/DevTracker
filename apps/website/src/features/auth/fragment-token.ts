'use client';

import { useSyncExternalStore } from 'react';

/**
 * Emailed links carry one-time tokens in the URL fragment (`#token=...`): fragments are never
 * sent to servers, so tokens stay out of access logs and Referer headers.
 */
export function takeTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (token) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return token;
}

// Read at most once per page load, because reading also removes the token from the address bar.
let captured: { token: string | null } | undefined;

const noopSubscribe = () => () => {};
const getSnapshot = () => (captured ??= { token: takeTokenFromHash() }).token;
const getServerSnapshot = () => undefined;

/** The fragment token: `undefined` during SSR/hydration, then the token or `null`. */
export function useFragmentToken(): string | null | undefined {
  return useSyncExternalStore(noopSubscribe, getSnapshot, getServerSnapshot);
}

'use client';

import { useSyncExternalStore } from 'react';

/** Whether the desktop sidebar is collapsed, remembered per browser. */
const KEY = 'devtrack.sidebarCollapsed';
const listeners = new Set<() => void>();
/** Used when storage is blocked, so the toggle still works on this page. */
let fallback = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return fallback;
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener('storage', notify); // other tabs
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
}

export function setSidebarCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    fallback = collapsed;
  }
  listeners.forEach((notify) => notify());
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

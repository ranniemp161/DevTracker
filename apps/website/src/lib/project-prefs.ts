'use client';

import { useSyncExternalStore } from 'react';

/**
 * Per-browser sidebar preferences: favourite projects and which projects are expanded.
 * Stored in localStorage (no account sync, by choice); every read and write tolerates
 * blocked storage by falling back to memory for this page.
 */
const FAVORITES = 'devtrack.favoriteProjects';
const EXPANDED = 'devtrack.expandedProjects';

const listeners = new Set<() => void>();
const memory = new Map<string, string>();
// Snapshots must be stable between changes, so parsed values are cached by raw string.
const cache = new Map<string, { raw: string | null; value: unknown }>();

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
  } catch {
    memory.set(key, raw);
  }
  listeners.forEach((notify) => notify());
}

function parsed<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  let value: T = fallback;
  try {
    const v: unknown = raw ? JSON.parse(raw) : fallback;
    if (valid(v)) value = v;
  } catch {
    // Corrupt value: use the fallback.
  }
  cache.set(key, { raw, value });
  return value;
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener('storage', notify); // other tabs
  return () => {
    listeners.delete(notify);
    window.removeEventListener('storage', notify);
  };
}

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isBoolMap = (v: unknown): v is Record<string, boolean> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === 'boolean');

const NO_FAVORITES: string[] = [];
const NO_CHOICES: Record<string, boolean> = {};

/** Favourite project ids, in the order they were added. */
export function useFavoriteProjects(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => parsed(FAVORITES, NO_FAVORITES, isStringList),
    () => NO_FAVORITES,
  );
}

export function toggleFavoriteProject(projectId: string) {
  const current = parsed(FAVORITES, NO_FAVORITES, isStringList);
  write(
    FAVORITES,
    current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId],
  );
}

/** Projects the person expanded (true) or collapsed (false); unset ones use the default. */
export function useExpandedProjects(): Record<string, boolean> {
  return useSyncExternalStore(
    subscribe,
    () => parsed(EXPANDED, NO_CHOICES, isBoolMap),
    () => NO_CHOICES,
  );
}

export function setProjectExpanded(projectId: string, expanded: boolean) {
  write(EXPANDED, { ...parsed(EXPANDED, NO_CHOICES, isBoolMap), [projectId]: expanded });
}

'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ApiError } from './api';
import { fetchIntoCache, readCache, revalidate, subscribeCache } from './api-cache';

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** True only while nothing is cached for the path yet. */
  loading: boolean;
  /** Re-fetches; existing data stays visible until the new response arrives. */
  reload: () => void;
}

const noop = () => undefined;

/**
 * Fetches `path` from the API (pass `null` to skip). Stale-while-revalidate: data cached
 * for the path shows at once and is refreshed in the background. No retries.
 */
export function useApiQuery<T>(path: string | null): QueryState<T> {
  const subscribe = useCallback(
    (onChange: () => void) => (path === null ? noop : subscribeCache(path, onChange)),
    [path],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (path === null ? undefined : readCache(path)),
    () => undefined,
  );

  useEffect(() => {
    if (path !== null) revalidate(path);
  }, [path]);

  const reload = useCallback(() => {
    if (path !== null) void fetchIntoCache(path, true);
  }, [path]);

  return {
    data: entry?.data as T | undefined,
    error: entry?.error,
    loading: path !== null && !entry,
    reload,
  };
}

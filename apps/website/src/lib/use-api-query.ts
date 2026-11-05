'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** Re-fetches; existing data stays visible until the new response arrives. */
  reload: () => void;
}

/** Fetches `path` from the API (pass `null` to skip). Small on purpose: no cache, no retries. */
export function useApiQuery<T>(path: string | null): QueryState<T> {
  const [result, setResult] = useState<{ path: string | null; data?: T; error?: ApiError }>({
    path: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    api<T>(path).then(
      (data) => !cancelled && setResult({ path, data }),
      (err: unknown) =>
        !cancelled &&
        setResult({
          path,
          error:
            err instanceof ApiError
              ? err
              : new ApiError(0, 'INTERNAL_ERROR', 'Something went wrong.'),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = result.path === path;
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: path !== null && !current,
    reload,
  };
}

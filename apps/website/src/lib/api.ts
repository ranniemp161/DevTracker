import type { ApiErrorBody, ApiFieldError, ErrorCode } from '@devtrack/types';

/** A failed API call, carrying the server's error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: ApiFieldError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
  }

  /** Field errors keyed by path, for showing next to form inputs. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) out[d.path] ??= d.message;
    return out;
  }
}

/** A request that gets no answer fails instead of leaving a spinner running forever. */
const REQUEST_TIMEOUT_MS = 30_000;

function networkError(err: unknown) {
  return new ApiError(
    0,
    'NETWORK_ERROR',
    err instanceof DOMException && err.name === 'TimeoutError'
      ? 'DevTrack took too long to respond. Please try again.'
      : 'Could not reach DevTrack. Check your connection and try again.',
  );
}

/**
 * Calls the DevTrack API through the same-origin `/api/v1` proxy and unwraps
 * `{ data }`. Throws `ApiError` for error envelopes, network failures and timeouts.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkError(err);
  }

  if (res.status === 204) return undefined as T;

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
      err?.requestId,
    );
  }
  return (json as { data: T }).data;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** GET a cursor-paginated list: `{ data: T[], meta: { nextCursor, hasMore } }`. */
export async function apiPage<T>(path: string): Promise<Page<T>> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw networkError(err);
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Something went wrong.',
    );
  }
  const page = json as { data: T[]; meta: { nextCursor: string | null; hasMore: boolean } };
  return { items: page.data, nextCursor: page.meta.nextCursor, hasMore: page.meta.hasMore };
}

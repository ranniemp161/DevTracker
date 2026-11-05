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

/**
 * Calls the DevTrack API through the same-origin `/api/v1` proxy and unwraps
 * `{ data }`. Throws `ApiError` for error envelopes and network failures.
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
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach DevTrack. Check your connection and try again.',
    );
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

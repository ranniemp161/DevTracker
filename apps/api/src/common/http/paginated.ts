import { AppException } from '../errors/app.exception';

/**
 * Return this from a controller for cursor-paginated lists. The response interceptor turns it
 * into `{ data: items, meta: { requestId, nextCursor, hasMore } }` (architecture §9).
 */
export class Paginated<T> {
  constructor(
    readonly items: T[],
    readonly nextCursor: string | null,
  ) {}
}

/** Opaque cursor: base64url-encoded JSON. Clients must treat it as an opaque string. */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string, isValid: (v: unknown) => v is T): T {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (isValid(value)) return value;
  } catch {
    // fall through
  }
  throw AppException.validation([{ path: 'cursor', message: 'Invalid cursor.' }]);
}

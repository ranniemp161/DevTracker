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

/** Cursor for lists ordered by `(created_at, id)` (millisecond-precision timestamps). */
export interface TimeCursor {
  t: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTimeCursor = (v: unknown): v is TimeCursor =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as TimeCursor).t === 'string' &&
  !Number.isNaN(Date.parse((v as TimeCursor).t)) &&
  typeof (v as TimeCursor).id === 'string' &&
  UUID_RE.test((v as TimeCursor).id);

export const timeCursorOf = (row: { createdAt: Date; id: string }): string =>
  encodeCursor({ t: row.createdAt.toISOString(), id: row.id });

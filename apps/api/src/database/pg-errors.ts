/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

interface PgLikeError {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/** Walks the error cause chain (Drizzle wraps driver errors) looking for a Postgres error. */
function findPgError(err: unknown): PgLikeError | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const e = current as PgLikeError;
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    current = e.cause;
  }
  return undefined;
}

/** True if `err` is a unique violation (optionally of the named constraint). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = findPgError(err);
  if (!pg || pg.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || pg.constraint === constraint;
}

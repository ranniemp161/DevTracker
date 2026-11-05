import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export { schema };
export * from './schema/index.js';

/**
 * Query-building helpers, re-exported so every consumer uses this package's single
 * drizzle-orm instance (and its type declarations) instead of importing drizzle-orm
 * directly. Add operators here as modules need them.
 */
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';

export type Database = NodePgDatabase<typeof schema>;
/** The callback argument of `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Database | Transaction;

/** Absolute path to the generated SQL migrations shipped with this package. */
export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export interface CreateDatabaseOptions {
  /** Maximum pooled connections per process. Keep low on serverless. */
  maxConnections?: number;
}

/**
 * Creates a Drizzle client over a node-postgres pool.
 * Use Neon's pooled connection string (PgBouncer) in deployed environments.
 * node-postgres is used (rather than the Neon HTTP driver) because interactive
 * transactions are required for outbox writes and task-number allocation.
 */
export function createDatabase(connectionString: string, options: CreateDatabaseOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const db: Database = drizzle({ client: pool, schema });
  return { db, pool };
}

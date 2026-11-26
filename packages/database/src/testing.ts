import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder, type Database } from './index.js';
import * as schema from './schema/index.js';

/** A fresh PGlite with every migration applied, the slow way (about 5 s, more under load). */
async function migratedClient(): Promise<PGlite> {
  const client = new PGlite();
  // Same migrations table location as drizzle.config.ts uses on Neon.
  await migrate(drizzle({ client }), {
    migrationsFolder,
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'public',
  });
  return client;
}

/**
 * A migrated database's data directory as a tarball. Loading it into a new PGlite takes
 * about 1 s, instead of replaying every migration. A test run builds it once (see the
 * API's vitest global setup) and every test database starts from it.
 */
export async function buildTestDatabaseSnapshot(): Promise<Blob> {
  const client = await migratedClient();
  try {
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}

/** Built at most once per module instance when no snapshot is passed in. */
let ownSnapshot: Promise<Blob> | null = null;

/**
 * In-memory PostgreSQL (PGlite) with all migrations applied — for tests only.
 * It runs the real migration SQL against a real Postgres engine, so constraints,
 * transactions and upserts behave as they do on Neon.
 *
 * `snapshot` is a tarball from `buildTestDatabaseSnapshot()`; without one, the first call
 * builds one and later calls in the same module instance reuse it.
 */
export async function createTestDatabase(options: { snapshot?: Blob } = {}) {
  const snapshot = options.snapshot ?? (await (ownSnapshot ??= buildTestDatabaseSnapshot()));
  const client = new PGlite({ loadDataDir: snapshot });
  const pgliteDb = drizzle({ client, schema });

  // The PGlite and node-postgres Drizzle clients share the same query-builder API.
  const db = pgliteDb as unknown as Database;

  /** Removes all rows from every application table (keeps the migrations table). */
  async function truncateAll(): Promise<void> {
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
    );
    if (rows.length === 0) return;
    const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
    await pgliteDb.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
  }

  return { db, client, truncateAll, close: () => client.close() };
}

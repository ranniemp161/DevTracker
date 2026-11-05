import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder, type Database } from './index.js';
import * as schema from './schema/index.js';

/**
 * In-memory PostgreSQL (PGlite) with all migrations applied — for tests only.
 * It runs the real migration SQL against a real Postgres engine, so constraints,
 * transactions and upserts behave as they do on Neon.
 */
export async function createTestDatabase() {
  const client = new PGlite();
  const pgliteDb = drizzle({ client, schema });
  // Same migrations table location as drizzle.config.ts uses on Neon.
  await migrate(pgliteDb, {
    migrationsFolder,
    migrationsTable: '__drizzle_migrations',
    migrationsSchema: 'public',
  });

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

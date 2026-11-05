import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Environment lives in the repository root `.env` (git-ignored). drizzle-kit runs from
// this package directory (and loads this file as CJS, so `import.meta` is unavailable).
const rootEnv = resolve(process.cwd(), '../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // `generate` does not connect, so a placeholder is fine there; `migrate` needs the real URL.
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder@localhost/placeholder',
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
  strict: true,
  verbose: true,
});

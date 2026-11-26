import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestDatabaseSnapshot } from '@devtrack/database/testing';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** A migrated test database's data directory (see `buildTestDatabaseSnapshot`). */
    testDatabaseSnapshot: string;
  }
}

/**
 * Applies the migrations once per test run and shares the result. Without this, every test
 * app replays every migration, which takes 40 s or more when many workers run at once.
 */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), 'devtrack-test-db-'));
  const file = join(dir, 'migrated.tar');
  const snapshot = await buildTestDatabaseSnapshot();
  await writeFile(file, Buffer.from(await snapshot.arrayBuffer()));
  project.provide('testDatabaseSnapshot', file);
  return () => rm(dir, { recursive: true, force: true });
}

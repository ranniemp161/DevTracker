import { describe, expect, it } from 'vitest';
import {
  connectRepositorySchema,
  extractTaskKeys,
  listInstallationsQuerySchema,
} from './github.js';

const installationId = '6f1c2a52-6a3c-4b84-9a43-1f1d1c0b6d7e';

describe('connectRepositorySchema', () => {
  it('accepts an installation UUID and a positive integer repository ID', () => {
    expect(connectRepositorySchema.parse({ installationId, githubRepositoryId: 123 })).toEqual({
      installationId,
      githubRepositoryId: 123,
    });
  });

  it.each([0, -1, 1.5, '123', null])('rejects repository ID %j', (githubRepositoryId) => {
    expect(connectRepositorySchema.safeParse({ installationId, githubRepositoryId }).success).toBe(
      false,
    );
  });

  it('rejects a non-UUID installation ID', () => {
    expect(
      connectRepositorySchema.safeParse({ installationId: '42', githubRepositoryId: 1 }).success,
    ).toBe(false);
  });
});

describe('listInstallationsQuerySchema', () => {
  it('requires a workspace UUID', () => {
    expect(listInstallationsQuerySchema.safeParse({}).success).toBe(false);
    expect(listInstallationsQuerySchema.parse({ workspaceId: installationId })).toEqual({
      workspaceId: installationId,
    });
  });
});

describe('extractTaskKeys', () => {
  it('finds keys in branch names and titles, case-insensitively', () => {
    expect(extractTaskKeys('feature/dev-104-login', 'Fix login (DEV-104, OPS-7)')).toEqual([
      'DEV-104',
      'OPS-7',
    ]);
  });

  it('ignores things that are not task keys', () => {
    expect(extractTaskKeys('release-2026', 'v1-0, sha256-abc, X-1, DEV-0, 1DEV-12')).toEqual([
      'RELEASE-2026',
    ]);
    expect(extractTaskKeys(null, undefined, '')).toEqual([]);
  });

  it('caps the number of keys', () => {
    const many = Array.from({ length: 15 }, (_, i) => `DEV-${i + 1}`).join(' ');
    expect(extractTaskKeys(many)).toHaveLength(10);
  });
});

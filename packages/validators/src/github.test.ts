import { describe, expect, it } from 'vitest';
import { connectRepositorySchema, listInstallationsQuerySchema } from './github.js';

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

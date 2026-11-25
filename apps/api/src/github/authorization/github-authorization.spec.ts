import {
  eq,
  githubInstallStates,
  users,
  workspaceMembers,
  workspaces,
  type Database,
  type Transaction,
} from '@devtrack/database';
import { createTestDatabase } from '@devtrack/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeGithubAppClient, testConfig } from '../../../test/utils/test-app';
import { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import type { RepositoryAccess } from '../access/repository-access.service';
import type { GithubAppClient } from '../github-app.client';
import { GithubAuthorization, VerifiedInstallation } from './github-authorization.service';

/**
 * GithubAuthorization through its interface, on PGlite with the fake GitHub client (#118).
 * Users, workspaces and memberships are seeded directly.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let github: FakeGithubAppClient;
let auth: GithubAuthorization;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  github = new FakeGithubAppClient();
  auth = new GithubAuthorization(
    db,
    testConfig(),
    new WorkspaceAccessService(db),
    github as unknown as GithubAppClient,
  );
});
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await database.truncateAll();
  github.reset();
  github.addInstallation(111, 'acme-org', [
    {
      id: 1001,
      fullName: 'acme-org/api',
      ownerLogin: 'acme-org',
      defaultBranch: 'main',
      visibility: 'private',
    },
  ]);
  github.addInstallation(222, 'other-org');
});

async function member(workspaceId: string, username: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  const [u] = await db
    .insert(users)
    .values({ email: `${username}@example.com`, username })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId, userId: u!.id, role });
  return u!.id;
}

/** Workspace Acme with an owner and an admin. */
async function acme() {
  const [founder] = await db
    .insert(users)
    .values({ email: 'founder@example.com', username: 'founder' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Acme', slug: 'acme', ownerId: founder!.id })
    .returning();
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws!.id, userId: founder!.id, role: 'OWNER' });
  const admin = await member(ws!.id, 'admin', 'ADMIN');
  return { workspaceId: ws!.id, owner: founder!.id, admin };
}

const demote = (workspaceId: string, userId: string) =>
  db.update(workspaceMembers).set({ role: 'MEMBER' }).where(eq(workspaceMembers.userId, userId));

/** Starts the install flow and returns the state GitHub hands back (and the browser cookie). */
async function started(
  userId: string,
  workspaceId: string,
  mode: 'install' | 'connect' = 'install',
) {
  const { installUrl, state } = await auth.start(userId, workspaceId, mode);
  expect(new URL(installUrl).searchParams.get('state')).toBe(state);
  return state;
}

describe('install on GitHub', () => {
  it('verifies an installation the GitHub user can manage, and revokes the token', async () => {
    const { workspaceId, admin } = await acme();
    github.codes.set('code', [111]);
    const state = await started(admin, workspaceId);
    const flow = await auth.consume(state, state);

    const verified = await auth.verifyInstall(flow, { installationId: '111', code: 'code' });
    expect(verified).not.toBe('requested');
    expect(verified).toMatchObject({
      userId: admin,
      workspaceId,
      installation: { id: 111, accountLogin: 'acme-org' },
      repositoryIds: [1001],
    });
    expect(github.revoked).toEqual(['ghu_code']);
  });

  it('refuses a replayed state', async () => {
    const { workspaceId, admin } = await acme();
    const state = await started(admin, workspaceId);
    await auth.consume(state, state);
    await expect(auth.consume(state, state)).rejects.toMatchObject({
      code: 'GITHUB_INSTALL_STATE_INVALID',
    });
  });

  it('refuses an expired state', async () => {
    const { workspaceId, admin } = await acme();
    const state = await started(admin, workspaceId);
    await db.update(githubInstallStates).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(auth.consume(state, state)).rejects.toMatchObject({
      code: 'GITHUB_INSTALL_STATE_INVALID',
    });
  });

  it('refuses a state that came back to a different browser', async () => {
    const { workspaceId, admin } = await acme();
    const state = await started(admin, workspaceId);
    const other = await started(admin, workspaceId);
    for (const cookie of [undefined, other])
      await expect(auth.consume(state, cookie)).rejects.toMatchObject({
        code: 'GITHUB_INSTALL_STATE_INVALID',
      });
  });

  it('refuses a user who lost the Admin role during sign-in', async () => {
    const { workspaceId, admin } = await acme();
    github.codes.set('code', [111]);
    const state = await started(admin, workspaceId);
    const flow = await auth.consume(state, state);
    await demote(workspaceId, admin);
    await expect(
      auth.verifyInstall(flow, { installationId: '111', code: 'code' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an installation GitHub does not confirm for this user', async () => {
    const { workspaceId, admin } = await acme();
    github.codes.set('code', [111]);
    for (const params of [
      { installationId: '222', code: 'code' }, // a forged installation ID
      { installationId: '111', code: 'unknown-code' }, // GitHub denied the code
      { installationId: '111' }, // no code at all
      { installationId: 'abc', code: 'code' },
    ]) {
      const state = await started(admin, workspaceId);
      const flow = await auth.consume(state, state);
      await expect(auth.verifyInstall(flow, params)).rejects.toMatchObject({
        code: 'GITHUB_INSTALL_NOT_AUTHORIZED',
      });
    }
  });

  it('reports "requested" when an organization owner must approve the app', async () => {
    const { workspaceId, admin } = await acme();
    const state = await started(admin, workspaceId);
    const flow = await auth.consume(state, state);
    expect(await auth.verifyInstall(flow, { setupAction: 'request' })).toBe('requested');
  });
});

describe('connect an existing installation', () => {
  /** Runs the GitHub authorization and returns the choice-window cookie. */
  async function choose(userId: string, workspaceId: string) {
    github.codes.set('existing', [111]);
    const state = await started(userId, workspaceId, 'connect');
    const flow = await auth.consume(state, state);
    return auth.prepareChoices(flow, 'existing');
  }

  it('offers the verified installations and verifies the chosen one, once', async () => {
    const { workspaceId, admin } = await acme();
    const cookie = await choose(admin, workspaceId);
    expect(github.revoked).toEqual(['ghu_existing']);
    expect(await auth.choices(admin, workspaceId, cookie)).toEqual([
      { githubInstallationId: 111, accountLogin: 'acme-org', accountType: 'Organization' },
    ]);
    const verified = await auth.verifyChoice(admin, workspaceId, 111, cookie);
    expect(verified).toMatchObject({ userId: admin, workspaceId, installation: { id: 111 } });
    await expect(auth.verifyChoice(admin, workspaceId, 111, cookie)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('binds the choice window to the user and the workspace', async () => {
    const { workspaceId, admin, owner } = await acme();
    const cookie = await choose(admin, workspaceId);
    const [other] = await db
      .insert(workspaces)
      .values({ name: 'Other', slug: 'other', ownerId: owner })
      .returning();
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: other!.id, userId: admin, role: 'ADMIN' });

    expect(await auth.choices(owner, workspaceId, cookie)).toEqual([]);
    expect(await auth.choices(admin, other!.id, cookie)).toEqual([]);
    await expect(auth.verifyChoice(owner, workspaceId, 111, cookie)).rejects.toMatchObject({
      status: 403,
    });
    await expect(auth.verifyChoice(admin, workspaceId, 222, cookie)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('closes the choice window after ten minutes', async () => {
    const { workspaceId, admin } = await acme();
    const cookie = await choose(admin, workspaceId);
    const [row] = await db
      .select()
      .from(githubInstallStates)
      .where(eq(githubInstallStates.mode, 'choose'));
    const window = row!.expiresAt.getTime() - row!.createdAt.getTime();
    expect(window).toBeGreaterThan(9 * 60 * 1000);
    expect(window).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);

    await db.update(githubInstallStates).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await auth.choices(admin, workspaceId, cookie)).toEqual([]);
    await expect(auth.verifyChoice(admin, workspaceId, 111, cookie)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('refuses a user who lost the Admin role before choosing', async () => {
    const { workspaceId, admin } = await acme();
    const cookie = await choose(admin, workspaceId);
    await demote(workspaceId, admin);
    await expect(auth.verifyChoice(admin, workspaceId, 111, cookie)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('VerifiedInstallation', () => {
  it('cannot be made outside GithubAuthorization', () => {
    // Compile-time check (pnpm typecheck): saving a connection takes only a verified proof.
    const _neverCalled = (access: RepositoryAccess, tx: Transaction) => {
      const forged = {
        installation: { id: 111, accountLogin: 'x', accountType: 'User', suspendedAt: null },
        repositoryIds: [],
        userId: 'u',
        workspaceId: 'w',
      };
      // @ts-expect-error a plain object is not a VerifiedInstallation
      const proof: VerifiedInstallation = forged;
      // @ts-expect-error connectWorkspace accepts nothing but the proof
      void access.connectWorkspace(tx, forged, { id: 'u', username: 'u' });
      // @ts-expect-error a copy of a real proof, pointed at another workspace, is not one either
      void access.connectWorkspace(tx, { ...proof, workspaceId: 'other' }, null);
      return proof;
    };
    expect(_neverCalled).toBeTypeOf('function');
  });

  it('is refused at runtime when it was not issued here', async () => {
    const { workspaceId, admin } = await acme();
    github.codes.set('code', [111]);
    const state = await started(admin, workspaceId);
    const real = await auth.verifyInstall(await auth.consume(state, state), {
      installationId: '111',
      code: 'code',
    });
    expect(VerifiedInstallation.isIssued(real)).toBe(true);
    expect(VerifiedInstallation.isIssued({ ...(real as object), workspaceId: 'other' })).toBe(
      false,
    );
    expect(
      () =>
        new VerifiedInstallation(
          undefined as never,
          real === 'requested' ? (undefined as never) : real.installation,
          [],
          admin,
          workspaceId,
        ),
    ).toThrow();
  });
});

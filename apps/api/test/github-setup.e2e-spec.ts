import {
  activityLogs,
  eq,
  githubInstallations,
  githubInstallStates,
  githubRepositories,
  githubWorkspaceConnections,
  outboxEvents,
} from '@devtrack/database';
import type { GithubRepo } from '../src/github/github-app.client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture, type TestUser } from './utils/fixtures';
import { cookieValue, createTestApp, setCookies, WEB_ORIGIN, type TestApp } from './utils/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const repo = (id: number, fullName: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({
  id,
  fullName,
  ownerLogin: fullName.split('/')[0]!,
  defaultBranch: 'main',
  visibility: 'private',
  ...extra,
});

/** Starts the install flow and returns the state GitHub would hand back. */
async function beginInstall(u: TestUser, ws: string) {
  const res = await u.browser.get(`/api/v1/github/install?workspaceId=${ws}`).expect(302);
  const location = new URL(res.headers.location as string);
  return { res, location, state: location.searchParams.get('state') };
}

/** GitHub's redirect back to the callback, from the given browser. */
const callback = (u: TestUser, params: Record<string, string>) =>
  u.browser.get(`/api/v1/github/install/callback?${new URLSearchParams(params)}`).expect(302);

const redirectOf = (res: { headers: Record<string, unknown> }) =>
  new URL(res.headers.location as string);

/** Runs the whole flow for GitHub installation `ghId` (accessible to the installing user). */
async function install(
  u: TestUser,
  ws: string,
  ghId = 111,
  account = 'acme-org',
  repos?: GithubRepo[],
) {
  if (!t.githubApp.installations.has(ghId)) {
    t.githubApp.addInstallation(
      ghId,
      account,
      repos ?? [repo(1001, `${account}/api`), repo(1002, `${account}/web`)],
    );
  }
  t.githubApp.codes.set(`code-${ghId}`, [ghId]);
  const { state } = await beginInstall(u, ws);
  const res = await callback(u, {
    installation_id: String(ghId),
    setup_action: 'install',
    code: `code-${ghId}`,
    state: state!,
  });
  expect(redirectOf(res).searchParams.get('github')).toBe('installed');
  const list = await u.browser.get(`/api/v1/github/installations?workspaceId=${ws}`).expect(200);
  const installation = list.body.data.installations.find(
    (i: { githubInstallationId: number }) => i.githubInstallationId === ghId,
  ) as { id: string; status: string };
  await u.browser
    .put(`/api/v1/github/installations/${installation.id}/repository-access`)
    .send({ githubRepositoryIds: t.githubApp.installations.get(ghId)!.repos.map((r) => r.id) })
    .expect(204);
  return installation;
}

describe('GitHub App installation flow', () => {
  it('redirects an admin to GitHub with a browser-bound, single-use state', async () => {
    const { owner, ws } = await projectFixture(t);
    const { res, location, state } = await beginInstall(owner, ws);

    expect(`${location.origin}${location.pathname}`).toBe(
      'https://github.com/apps/devtrack-test/installations/new',
    );
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = setCookies(res).get('devtrack_gh_install_state');
    expect(cookieValue(cookie)).toBe(state);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    // Only the hash is stored.
    const rows = await t.db.select().from(githubInstallStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateHash).not.toBe(state);
    expect(rows[0]!.workspaceId).toBe(ws);
  });

  it('only lets workspace admins start an installation', async () => {
    const { admin, dev, outsider, ws } = await projectFixture(t);
    await beginInstall(admin, ws);

    const asMember = await dev.browser.get(`/api/v1/github/install?workspaceId=${ws}`).expect(302);
    expect(redirectOf(asMember).pathname).toBe(`/workspaces/${ws}/settings`);
    expect(redirectOf(asMember).searchParams.get('githubError')).toBe('FORBIDDEN');

    const asOutsider = await outsider.browser
      .get(`/api/v1/github/install?workspaceId=${ws}`)
      .expect(302);
    expect(redirectOf(asOutsider).searchParams.get('githubError')).toBe('NOT_FOUND');

    const badId = await outsider.browser.get('/api/v1/github/install?workspaceId=nope').expect(302);
    expect(redirectOf(badId).pathname).toBe('/');

    await t.http().get(`/api/v1/github/install?workspaceId=${ws}`).expect(401);
    expect(await t.db.select().from(githubInstallStates)).toHaveLength(1);
  });

  it('records the installation after GitHub confirms the user can access it', async () => {
    const { owner, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org');
    t.githubApp.codes.set('good-code', [111]);
    const { state } = await beginInstall(owner, ws);

    const res = await callback(owner, {
      installation_id: '111',
      setup_action: 'install',
      code: 'good-code',
      state: state!,
    });
    const target = redirectOf(res);
    expect(target.origin).toBe(WEB_ORIGIN);
    expect(target.pathname).toBe(`/workspaces/${ws}/settings`);
    expect(target.searchParams.get('github')).toBe('installed');
    // The state cookie is cleared and the user token is revoked once verified.
    expect(cookieValue(setCookies(res).get('devtrack_gh_install_state'))).toBe('');
    expect(t.githubApp.revoked).toEqual(['ghu_good-code']);

    const list = await owner.browser.get(`/api/v1/github/installations?workspaceId=${ws}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual({
      appConfigured: true,
      installations: [
        expect.objectContaining({
          workspaceId: ws,
          githubInstallationId: 111,
          accountLogin: 'acme-org',
          accountType: 'Organization',
          status: 'ACTIVE',
          installedBy: expect.objectContaining({ username: 'owner' }),
        }),
      ],
    });

    const [activity] = await t.db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.entityType, 'github_installation'));
    expect(activity).toMatchObject({ workspaceId: ws, projectId: null, action: 'installed' });
    expect(activity!.metadata).toEqual({ account: 'acme-org' });

    // The state is single use.
    const replay = await callback(owner, {
      installation_id: '111',
      code: 'good-code',
      state: state!,
    });
    expect(redirectOf(replay).searchParams.get('githubError')).toBe('GITHUB_INSTALL_STATE_INVALID');
  });

  it('rejects a forged installation_id the GitHub user cannot access', async () => {
    const { owner, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org');
    t.githubApp.addInstallation(222, 'victim-org');
    t.githubApp.codes.set('good-code', [111]);
    const { state } = await beginInstall(owner, ws);

    const res = await callback(owner, {
      installation_id: '222',
      setup_action: 'install',
      code: 'good-code',
      state: state!,
    });
    expect(redirectOf(res).searchParams.get('githubError')).toBe('GITHUB_INSTALL_NOT_AUTHORIZED');
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
    expect(t.githubApp.revoked).toEqual(['ghu_good-code']);
  });

  it.each([
    ['no code', { installation_id: '111', setup_action: 'install' }],
    ['an invalid code', { installation_id: '111', setup_action: 'install', code: 'forged' }],
    ['a malformed installation_id', { installation_id: '1e3', code: 'good-code' }],
  ])('rejects a callback with %s', async (_label, params) => {
    const { owner, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org');
    t.githubApp.codes.set('good-code', [111]);
    const { state } = await beginInstall(owner, ws);
    const res = await callback(owner, { ...params, state: state! });
    expect(redirectOf(res).searchParams.get('githubError')).toBe('GITHUB_INSTALL_NOT_AUTHORIZED');
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
  });

  it('rejects a callback without the matching state cookie or with a wrong state', async () => {
    const { owner, admin, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org');
    t.githubApp.codes.set('good-code', [111]);
    const { state } = await beginInstall(owner, ws);

    // Another browser (no cookie) replays the owner's state.
    const other = await callback(admin, {
      installation_id: '111',
      code: 'good-code',
      state: state!,
    });
    expect(redirectOf(other).pathname).toBe('/');
    expect(redirectOf(other).searchParams.get('githubError')).toBe('GITHUB_INSTALL_STATE_INVALID');

    const wrong = await callback(owner, { installation_id: '111', code: 'good-code', state: 'x' });
    expect(redirectOf(wrong).searchParams.get('githubError')).toBe('GITHUB_INSTALL_STATE_INVALID');

    // An installation started from GitHub (no state at all) is not bound to any workspace.
    const none = await callback(owner, { installation_id: '111', code: 'good-code' });
    expect(redirectOf(none).searchParams.get('githubError')).toBe('GITHUB_INSTALL_STATE_INVALID');
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
  });

  it('rejects an expired state', async () => {
    const { owner, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org');
    t.githubApp.codes.set('good-code', [111]);
    const { state } = await beginInstall(owner, ws);
    await t.db.update(githubInstallStates).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await callback(owner, { installation_id: '111', code: 'good-code', state: state! });
    expect(redirectOf(res).searchParams.get('githubError')).toBe('GITHUB_INSTALL_STATE_INVALID');
  });

  it('re-checks that the user is still an admin when GitHub redirects back', async () => {
    const { owner, admin, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org');
    t.githubApp.codes.set('good-code', [111]);
    const { state } = await beginInstall(admin, ws);
    await owner.browser
      .patch(`/api/v1/workspaces/${ws}/members/${admin.id}`)
      .send({ role: 'MEMBER' })
      .expect(200);

    const res = await callback(admin, { installation_id: '111', code: 'good-code', state: state! });
    expect(redirectOf(res).searchParams.get('githubError')).toBe('FORBIDDEN');
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
  });

  it('reports an approval request without installing anything', async () => {
    const { owner, ws } = await projectFixture(t);
    const { state } = await beginInstall(owner, ws);
    const res = await callback(owner, { setup_action: 'request', code: 'c', state: state! });
    expect(redirectOf(res).searchParams.get('github')).toBe('requested');
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
  });

  it('shares one verified installation across independently connected workspaces', async () => {
    const { owner, ws } = await projectFixture(t);
    await install(owner, ws, 111, 'acme-org');

    // Re-running the flow for the same workspace refreshes the account details.
    t.githubApp.installations.get(111)!.accountLogin = 'acme-renamed';
    await install(owner, ws, 111);
    const [row] = await t.db.select().from(githubInstallations);
    expect(row!.accountLogin).toBe('acme-renamed');

    // Another workspace may connect only after its own verified GitHub flow.
    const other: string = (await owner.browser.post('/api/v1/workspaces').send({ name: 'Other' }))
      .body.data.workspace.id;
    t.githubApp.codes.set('code-111', [111]);
    const { state } = await beginInstall(owner, other);
    const res = await callback(owner, { installation_id: '111', code: 'code-111', state: state! });
    expect(redirectOf(res).pathname).toBe(`/workspaces/${other}/settings`);
    expect(redirectOf(res).searchParams.get('github')).toBe('installed');
    expect(await t.db.select().from(githubInstallations)).toHaveLength(1);
    const connections = await t.db.select().from(githubWorkspaceConnections);
    expect(connections).toHaveLength(2);
    expect(new Set(connections.map((c) => c.workspaceId))).toEqual(new Set([ws, other]));
  });
});

describe('installations and available repositories', () => {
  it('lists installations for admins only', async () => {
    const { owner, admin, dev, outsider, ws } = await projectFixture(t);
    await install(owner, ws);

    const res = await admin.browser.get(`/api/v1/github/installations?workspaceId=${ws}`);
    expect(res.status).toBe(200);
    expect(res.body.data.installations).toHaveLength(1);
    await dev.browser.get(`/api/v1/github/installations?workspaceId=${ws}`).expect(403);
    await outsider.browser.get(`/api/v1/github/installations?workspaceId=${ws}`).expect(404);
    await owner.browser.get('/api/v1/github/installations').expect(400);
  });

  it('reports when the GitHub App is not configured', async () => {
    const app = await createTestApp({ githubApp: null });
    try {
      const { owner, ws } = await projectFixture(app);
      const list = await owner.browser.get(`/api/v1/github/installations?workspaceId=${ws}`);
      expect(list.body.data).toEqual({ appConfigured: false, installations: [] });
      const start = await owner.browser.get(`/api/v1/github/install?workspaceId=${ws}`).expect(302);
      expect(redirectOf(start).searchParams.get('githubError')).toBe('GITHUB_APP_NOT_CONFIGURED');
    } finally {
      await app.close();
    }
  });

  it('lists repositories live from GitHub with their project connections', async () => {
    const { owner, admin, dev, outsider, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws, 111, 'acme-org', [
      repo(1002, 'acme-org/web'),
      repo(1001, 'acme-org/api', { visibility: 'public' }),
    ]);
    await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ installationId: inst.id, githubRepositoryId: 1001 })
      .expect(201);

    const res = await admin.browser.get(`/api/v1/github/installations/${inst.id}/repositories`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        githubRepositoryId: 1001,
        fullName: 'acme-org/api',
        ownerLogin: 'acme-org',
        defaultBranch: 'main',
        visibility: 'public',
        connectedProjectIds: [project],
      },
      expect.objectContaining({ fullName: 'acme-org/web', connectedProjectIds: [] }),
    ]);

    // Unconnected repository names are only shown to admins.
    await dev.browser.get(`/api/v1/github/installations/${inst.id}/repositories`).expect(403);
    await outsider.browser.get(`/api/v1/github/installations/${inst.id}/repositories`).expect(404);
    await owner.browser.get('/api/v1/github/installations/nope/repositories').expect(404);
  });

  it('refreshes stored names when a repository is renamed on GitHub', async () => {
    const { owner, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws);
    await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ installationId: inst.id, githubRepositoryId: 1001 })
      .expect(201);

    const gh = t.githubApp.installations.get(111)!;
    gh.repos[0] = repo(1001, 'acme-org/api-v2', { defaultBranch: 'trunk' });
    await owner.browser.get(`/api/v1/github/installations/${inst.id}/repositories`).expect(200);

    const connected = await owner.browser.get(`/api/v1/projects/${project}/repositories`);
    expect(connected.body.data[0]).toMatchObject({
      githubRepositoryId: 1001,
      fullName: 'acme-org/api-v2',
      defaultBranch: 'trunk',
      url: 'https://github.com/acme-org/api-v2',
    });
  });

  it.each([['SUSPENDED'], ['REMOVED']] as const)(
    'marks an installation %s when GitHub refuses it',
    async (status) => {
      const { owner, ws } = await projectFixture(t);
      const inst = await install(owner, ws);
      t.githubApp.installations.get(111)!.unavailable = status;

      const res = await owner.browser.get(`/api/v1/github/installations/${inst.id}/repositories`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GITHUB_INSTALLATION_UNAVAILABLE');
      const [row] = await t.db.select().from(githubInstallations);
      expect(row!.status).toBe(status);

      // Later calls fail fast without asking GitHub again.
      t.githubApp.installations.get(111)!.unavailable = undefined;
      await owner.browser.get(`/api/v1/github/installations/${inst.id}/repositories`).expect(409);
    },
  );
});

describe('project repositories', () => {
  it('lets admins connect a repository and project members see it', async () => {
    const { owner, admin, dev, bystander, outsider, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws);

    const res = await admin.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ installationId: inst.id, githubRepositoryId: 1001 });
    expect(res.status).toBe(201);
    expect(res.body.data.repository).toEqual({
      id: expect.any(String),
      installationId: inst.id,
      installationStatus: 'ACTIVE',
      githubRepositoryId: 1001,
      fullName: 'acme-org/api',
      ownerLogin: 'acme-org',
      defaultBranch: 'main',
      visibility: 'private',
      url: 'https://github.com/acme-org/api',
      connectedBy: expect.objectContaining({ username: 'admin' }),
      connectedAt: expect.any(String),
    });

    const list = await dev.browser.get(`/api/v1/projects/${project}/repositories`).expect(200);
    expect(list.body.data.map((r: { fullName: string }) => r.fullName)).toEqual(['acme-org/api']);
    await bystander.browser.get(`/api/v1/projects/${project}/repositories`).expect(404);
    await outsider.browser.get(`/api/v1/projects/${project}/repositories`).expect(404);

    // Activity and outbox are written with the connection, without secrets.
    const activity = await t.db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.action, 'repository_connected'));
    expect(activity).toHaveLength(1);
    expect(activity[0]!.metadata).toEqual({
      repository: { id: res.body.data.repository.id, fullName: 'acme-org/api' },
    });
    const events = await t.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'project.repository_connected'));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.payload)).not.toMatch(/token|secret/i);
  });

  it('only lets workspace admins connect repositories', async () => {
    const { owner, dev, outsider, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws);
    const body = { installationId: inst.id, githubRepositoryId: 1001 };
    await dev.browser.post(`/api/v1/projects/${project}/repositories`).send(body).expect(403);
    await outsider.browser.post(`/api/v1/projects/${project}/repositories`).send(body).expect(404);
  });

  it('validates the request and rejects inaccessible or duplicate repositories', async () => {
    const { owner, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws);
    const post = (body: unknown) =>
      owner.browser.post(`/api/v1/projects/${project}/repositories`).send(body as object);

    const invalid = await post({ installationId: inst.id, githubRepositoryId: '1001' });
    expect(invalid.status).toBe(400);

    const missing = await post({ installationId: inst.id, githubRepositoryId: 9999 });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('FORBIDDEN');

    await post({ installationId: inst.id, githubRepositoryId: 1001 }).expect(201);
    const dup = await post({ installationId: inst.id, githubRepositoryId: 1001 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('REPOSITORY_ALREADY_CONNECTED');
    expect(await t.db.select().from(githubRepositories)).toHaveLength(1);
  });

  it("never connects through another workspace's installation", async () => {
    const { owner, ws, project } = await projectFixture(t);
    const other: string = (await owner.browser.post('/api/v1/workspaces').send({ name: 'Other' }))
      .body.data.workspace.id;
    const foreign = await install(owner, other, 333, 'other-org');
    void ws;

    const res = await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ installationId: foreign.id, githubRepositoryId: 1001 });
    expect(res.status).toBe(404);
    expect(await t.db.select().from(githubRepositories)).toEqual([]);
  });

  it('refuses suspended installations and archived projects', async () => {
    const { owner, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws);
    const body = { installationId: inst.id, githubRepositoryId: 1001 };

    t.githubApp.installations.get(111)!.unavailable = 'SUSPENDED';
    const suspended = await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send(body);
    expect(suspended.status).toBe(409);
    expect(suspended.body.error.code).toBe('GITHUB_INSTALLATION_UNAVAILABLE');

    await owner.browser.delete(`/api/v1/projects/${project}`).expect(204);
    const archived = await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send(body);
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('PROJECT_ARCHIVED');
  });

  it('shares a repository across projects and keeps it after the last disconnect', async () => {
    const { owner, dev, ws, project } = await projectFixture(t);
    const inst = await install(owner, ws);
    const second: string = (
      await owner.browser
        .post(`/api/v1/workspaces/${ws}/projects`)
        .send({ name: 'Mobile', key: 'MOB' })
        .expect(201)
    ).body.data.project.id;
    const body = { installationId: inst.id, githubRepositoryId: 1001 };
    const first = await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send(body)
      .expect(201);
    const repoId: string = first.body.data.repository.id;
    const again = await owner.browser
      .post(`/api/v1/projects/${second}/repositories`)
      .send(body)
      .expect(201);
    expect(again.body.data.repository.id).toBe(repoId);

    const available = await owner.browser.get(
      `/api/v1/github/installations/${inst.id}/repositories`,
    );
    expect(available.body.data[0].connectedProjectIds.sort()).toEqual([project, second].sort());

    // Members cannot disconnect.
    await dev.browser.delete(`/api/v1/projects/${project}/repositories/${repoId}`).expect(403);

    await owner.browser.delete(`/api/v1/projects/${project}/repositories/${repoId}`).expect(204);
    let [row] = await t.db.select().from(githubRepositories);
    expect(row!.disconnectedAt).toBeNull(); // still connected to the second project

    await owner.browser.delete(`/api/v1/projects/${second}/repositories/${repoId}`).expect(204);
    [row] = await t.db.select().from(githubRepositories);
    expect(row!.disconnectedAt).toBeInstanceOf(Date);

    const gone = await owner.browser.delete(`/api/v1/projects/${second}/repositories/${repoId}`);
    expect(gone.status).toBe(404);
    expect((await owner.browser.get(`/api/v1/projects/${project}/repositories`)).body.data).toEqual(
      [],
    );

    // Reconnecting reuses the row and clears the disconnection.
    await owner.browser.post(`/api/v1/projects/${project}/repositories`).send(body).expect(201);
    [row] = await t.db.select().from(githubRepositories);
    expect(row!.id).toBe(repoId);
    expect(row!.disconnectedAt).toBeNull();

    const disconnected = await t.db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.action, 'repository_disconnected'));
    expect(disconnected).toHaveLength(2);
  });
});

describe('shared GitHub workspace connections', () => {
  async function authorizeExisting(user: TestUser, ws: string, code = 'existing-code') {
    const start = await user.browser
      .get(`/api/v1/github/install?workspaceId=${ws}&mode=connect`)
      .expect(302);
    const url = new URL(start.headers.location as string);
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv23li-test-app');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${WEB_ORIGIN}/api/v1/github/install/callback`,
    );
    const result = await callback(user, { code, state: url.searchParams.get('state')! });
    expect(redirectOf(result).searchParams.get('github')).toBe('choose');
  }

  it('connects an existing installation after fresh browser-bound GitHub proof; grants start empty', async () => {
    const { owner, outsider, ws } = await projectFixture(t);
    const first = await install(owner, ws);
    const other: string = (
      await outsider.browser.post('/api/v1/workspaces').send({ name: 'Client' })
    ).body.data.workspace.id;
    const project: string = (
      await outsider.browser
        .post(`/api/v1/workspaces/${other}/projects`)
        .send({ name: 'Website', key: 'WEB' })
    ).body.data.project.id;
    // Knowing the global installation ID or another workspace's connection ID is insufficient.
    await outsider.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: other, githubInstallationId: 111 })
      .expect(403);
    await outsider.browser
      .get(`/api/v1/github/installations/${first.id}/repository-access`)
      .expect(404);
    t.githubApp.codes.set('existing-code', [111]);
    t.githubApp.userRepositoryIds.set('existing-code', [1002]);
    await authorizeExisting(outsider, other);
    expect(t.githubApp.revoked).toContain('ghu_existing-code');
    const available = await outsider.browser
      .get(`/api/v1/github/available-installations?workspaceId=${other}`)
      .expect(200);
    expect(available.body.data).toEqual([
      { githubInstallationId: 111, accountLogin: 'acme-org', accountType: 'Organization' },
    ]);
    // This proof is scoped to the target workspace and current DevTrack user.
    expect(
      (await owner.browser.get(`/api/v1/github/available-installations?workspaceId=${ws}`)).body
        .data,
    ).toEqual([]);
    await outsider.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: other, githubInstallationId: 222 })
      .expect(403);
    await outsider.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: other, githubInstallationId: 111 })
      .expect(201);
    await outsider.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: other, githubInstallationId: 111 })
      .expect(403);
    const list = await outsider.browser
      .get(`/api/v1/github/installations?workspaceId=${other}`)
      .expect(200);
    const second: string = list.body.data.installations[0].id;
    expect(second).not.toBe(first.id);
    expect(await t.db.select().from(githubInstallations)).toHaveLength(1);
    expect(
      (await outsider.browser.get(`/api/v1/github/installations/${second}/repositories`)).body.data,
    ).toEqual([]);
    const access = await outsider.browser
      .get(`/api/v1/github/installations/${second}/repository-access`)
      .expect(200);
    expect(access.body.data).toEqual([
      expect.objectContaining({
        githubRepositoryId: 1002,
        allowed: false,
        connectedProjectIds: [],
      }),
    ]);
    // The installation can read 1001, but this GitHub user cannot delegate it.
    await outsider.browser
      .put(`/api/v1/github/installations/${second}/repository-access`)
      .send({ githubRepositoryIds: [1001] })
      .expect(403);
    await outsider.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ installationId: second, githubRepositoryId: 1002 })
      .expect(403);
    await outsider.browser
      .put(`/api/v1/github/installations/${second}/repository-access`)
      .send({ githubRepositoryIds: [1002] })
      .expect(204);
    await outsider.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ installationId: second, githubRepositoryId: 1002 })
      .expect(201);
    const firstAvailable = await owner.browser
      .get(`/api/v1/github/installations/${first.id}/repositories`)
      .expect(200);
    expect(
      firstAvailable.body.data.every(
        (r: { connectedProjectIds: string[] }) => !r.connectedProjectIds.includes(project),
      ),
    ).toBe(true);
  });

  it('expires existing-installation proof and rechecks the workspace role before connecting', async () => {
    const { owner, admin, ws } = await projectFixture(t);
    t.githubApp.addInstallation(111, 'acme-org', [repo(1001, 'acme-org/api')]);
    t.githubApp.codes.set('existing-code', [111]);
    await authorizeExisting(admin, ws);
    await owner.browser
      .patch(`/api/v1/workspaces/${ws}/members/${admin.id}`)
      .send({ role: 'MEMBER' })
      .expect(200);
    await admin.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: ws, githubInstallationId: 111 })
      .expect(403);
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
    await authorizeExisting(owner, ws);
    await t.db.update(githubInstallStates).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(
      (await owner.browser.get(`/api/v1/github/available-installations?workspaceId=${ws}`)).body
        .data,
    ).toEqual([]);
    await owner.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: ws, githubInstallationId: 111 })
      .expect(403);
    expect(await t.db.select().from(githubInstallations)).toEqual([]);
  });

  it('rejects a foreign browser callback and GitHub authorization denial for an existing connection', async () => {
    const { owner, admin, ws } = await projectFixture(t);
    const start = await owner.browser
      .get(`/api/v1/github/install?workspaceId=${ws}&mode=connect`)
      .expect(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const foreign = await callback(admin, { state, code: 'existing-code' });
    expect(redirectOf(foreign).searchParams.get('githubError')).toBe(
      'GITHUB_INSTALL_STATE_INVALID',
    );
    const denied = await callback(owner, { state, error: 'access_denied' });
    expect(redirectOf(denied).searchParams.get('githubError')).toBe(
      'GITHUB_INSTALL_NOT_AUTHORIZED',
    );
    expect(await t.db.select().from(githubWorkspaceConnections)).toEqual([]);
  });

  it('validates repository allowlists and restricts connection management to workspace admins', async () => {
    const { owner, dev, outsider, ws } = await projectFixture(t);
    const installation = await install(owner, ws);
    const path = `/api/v1/github/installations/${installation.id}`;
    for (const user of [dev, outsider]) {
      const status = user === dev ? 403 : 404;
      await user.browser
        .put(`${path}/repository-access`)
        .send({ githubRepositoryIds: [] })
        .expect(status);
      await user.browser.delete(path).expect(status);
    }
    for (const ids of [[1001, 1001], [0], ['1001'], [-1]]) {
      await owner.browser
        .put(`${path}/repository-access`)
        .send({ githubRepositoryIds: ids })
        .expect(400);
    }
    await owner.browser
      .put(`${path}/repository-access`)
      .send({ githubRepositoryIds: [9999] })
      .expect(403);
  });

  it('does not delegate an installer’s ungranted GitHub repository choices to other workspace admins', async () => {
    const { owner, admin, ws } = await projectFixture(t);
    const installation = await install(owner, ws);
    const path = `/api/v1/github/installations/${installation.id}`;
    await owner.browser
      .put(`${path}/repository-access`)
      .send({ githubRepositoryIds: [1001] })
      .expect(204);
    const clientView = await admin.browser.get(`${path}/repository-access`).expect(200);
    expect(
      clientView.body.data.map((r: { githubRepositoryId: number }) => r.githubRepositoryId),
    ).toEqual([1001]);
    await admin.browser
      .put(`${path}/repository-access`)
      .send({ githubRepositoryIds: [1001, 1002] })
      .expect(403);
    // Admins may still revoke delegated access. To expand it, they must prove their own GitHub access.
    await admin.browser
      .put(`${path}/repository-access`)
      .send({ githubRepositoryIds: [] })
      .expect(204);
    t.githubApp.codes.set('existing-code', [111]);
    t.githubApp.userRepositoryIds.set('existing-code', [1002]);
    await authorizeExisting(admin, ws);
    await admin.browser
      .post('/api/v1/github/connections')
      .send({ workspaceId: ws, githubInstallationId: 111 })
      .expect(201);
    expect(
      (await admin.browser.get(`${path}/repository-access`)).body.data.map(
        (r: { githubRepositoryId: number }) => r.githubRepositoryId,
      ),
    ).toEqual([1002]);
    await admin.browser
      .put(`${path}/repository-access`)
      .send({ githubRepositoryIds: [1002] })
      .expect(204);
    expect(
      (await owner.browser.get(`${path}/repository-access`)).body.data.map(
        (r: { githubRepositoryId: number }) => r.githubRepositoryId,
      ),
    ).toEqual([1002]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, type TestApp } from './utils/test-app';

/**
 * The connection rename's compatibility window (#114): the API serves the glossary's names
 * (`/github/connections`, `connectionId`, `connections`) next to the old installation names, so
 * the website and API keep working whichever deploys first.
 */
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

const repo = (id: number, fullName: string) => ({
  id,
  fullName,
  ownerLogin: fullName.split('/')[0]!,
  defaultBranch: 'main',
  visibility: 'private',
});

/** A workspace connected to installation 111 (repos 1001 and 1002), nothing granted yet. */
async function connected() {
  const f = await projectFixture(t);
  t.githubApp.addInstallation(111, 'acme-org', [
    repo(1001, 'acme-org/api'),
    repo(1002, 'acme-org/web'),
  ]);
  t.githubApp.codes.set('install-code', [111]);
  const start = await f.owner.browser.get(`/api/v1/github/install?workspaceId=${f.ws}`).expect(302);
  const state = new URL(start.headers.location as string).searchParams.get('state')!;
  await f.owner.browser
    .get(
      `/api/v1/github/install/callback?installation_id=111&setup_action=install&code=install-code&state=${state}`,
    )
    .expect(302);
  return f;
}

describe.each([
  ['old', '/api/v1/github/installations'],
  ['new', '/api/v1/github/connections'],
])('connection routes under the %s path', (_name, base) => {
  it('lists, reads and updates repository access, and disconnects', async () => {
    const { owner, ws } = await connected();
    const list = await owner.browser.get(`${base}?workspaceId=${ws}`).expect(200);
    const id: string = list.body.data.connections[0].id;

    await owner.browser
      .put(`${base}/${id}/repository-access`)
      .send({ githubRepositoryIds: [1001] })
      .expect(204);
    const access = await owner.browser.get(`${base}/${id}/repository-access`).expect(200);
    expect(
      access.body.data.map((r: { githubRepositoryId: number; allowed: boolean }) => [
        r.githubRepositoryId,
        r.allowed,
      ]),
    ).toEqual([
      [1001, true],
      [1002, false],
    ]);
    const repositories = await owner.browser.get(`${base}/${id}/repositories`).expect(200);
    expect(repositories.body.data.map((r: { fullName: string }) => r.fullName)).toEqual([
      'acme-org/api',
    ]);

    await owner.browser.delete(`${base}/${id}`).expect(204);
    expect((await owner.browser.get(`${base}?workspaceId=${ws}`)).body.data.connections).toEqual(
      [],
    );
  });
});

describe('connection field names', () => {
  it('returns the connection list under both connections and installations', async () => {
    const { owner, ws } = await connected();
    const res = await owner.browser.get(`/api/v1/github/connections?workspaceId=${ws}`).expect(200);
    expect(res.body.data.connections).toHaveLength(1);
    expect(res.body.data.installations).toEqual(res.body.data.connections);
    expect(res.body.data.connections[0]).toMatchObject({
      githubInstallationId: 111,
      accountLogin: 'acme-org',
    });
  });

  it.each(['connectionId', 'installationId'])(
    'connects a project repository with %s and returns both names',
    async (field) => {
      const { owner, ws, project } = await connected();
      const id: string = (await owner.browser.get(`/api/v1/github/connections?workspaceId=${ws}`))
        .body.data.connections[0].id;
      await owner.browser
        .put(`/api/v1/github/connections/${id}/repository-access`)
        .send({ githubRepositoryIds: [1001] })
        .expect(204);

      const res = await owner.browser
        .post(`/api/v1/projects/${project}/repositories`)
        .send({ [field]: id, githubRepositoryId: 1001 })
        .expect(201);
      expect(res.body.data.repository).toMatchObject({ connectionId: id, installationId: id });
      const listed = await owner.browser.get(`/api/v1/projects/${project}/repositories`);
      expect(listed.body.data[0]).toMatchObject({ connectionId: id, installationId: id });
    },
  );

  it('refuses a request without a connection', async () => {
    const { owner, project } = await connected();
    const res = await owner.browser
      .post(`/api/v1/projects/${project}/repositories`)
      .send({ githubRepositoryId: 1001 });
    expect(res.status).toBe(400);
  });
});

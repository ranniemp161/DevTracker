import { githubReleases } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deliver, githubFixture, releaseEvent } from './utils/github';
import { createTestApp, type TestApp } from './utils/test-app';

/** Decision record 0026: GitHub releases linked to milestones. */
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

type Fixture = Awaited<ReturnType<typeof githubFixture>>;

const release = (tag: string, overrides: Record<string, unknown> = {}) => {
  const e = releaseEvent();
  return {
    ...e,
    release: {
      ...e.release,
      tag_name: tag,
      name: null,
      html_url: `https://github.com/acme-org/api/releases/tag/${tag}`,
      published_at: '2026-11-20T10:00:00Z',
      ...overrides,
    },
  };
};

async function milestone(f: Fixture, name: string, status?: string) {
  return (
    await f.admin.browser
      .post(`/api/v1/projects/${f.project}/milestones`)
      .send({ name, ...(status ? { status } : {}) })
      .expect(201)
  ).body.data.milestone as { id: string; status: string };
}

const milestones = async (f: Fixture) =>
  (await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`).expect(200)).body.data as {
    id: string;
    name: string;
    status: string;
    releases: { tagName: string; source: string; repository: string }[];
  }[];

const releasesOf = async (f: Fixture, name: string) =>
  (await milestones(f)).find((m) => m.name === name)!.releases;

describe('published releases (0026 §3)', () => {
  it('are stored once per tag and auto-link to undelivered milestones with a matching name', async () => {
    const f = await githubFixture(t);
    await milestone(f, '1.2', 'ACTIVE');
    await milestone(f, 'v1.2', 'DELIVERED');
    await milestone(f, 'Checkout');

    await deliver(t, 'release', release('v1.2')).expect(202);
    // Published again (for example after editing): updated, not duplicated.
    await deliver(t, 'release', release('v1.2', { name: 'Spring' })).expect(202);
    expect(await t.db.select().from(githubReleases)).toHaveLength(1);

    expect(await releasesOf(f, '1.2')).toMatchObject([
      { tagName: 'v1.2', source: 'AUTO', repository: 'acme-org/api' },
    ]);
    expect(await releasesOf(f, 'v1.2')).toEqual([]);
    expect(await releasesOf(f, 'Checkout')).toEqual([]);

    // A matching release name links too; linking never moves the stage.
    await deliver(t, 'release', release('v2.0.0', { name: 'checkout' })).expect(202);
    const all = await milestones(f);
    expect(all.find((m) => m.name === 'Checkout')).toMatchObject({
      status: 'PLANNED',
      releases: [{ tagName: 'v2.0.0', source: 'AUTO' }],
    });
    expect(all.find((m) => m.name === '1.2')!.status).toBe('ACTIVE');
  });
});

describe('linking releases by hand (0026 §4)', () => {
  it('lets leads and admins link and unlink releases of connected repositories', async () => {
    const f = await githubFixture(t);
    const m = await milestone(f, 'Beta');
    await deliver(t, 'release', release('v0.9.0')).expect(202);

    const listed = await f.dev.browser.get(`/api/v1/projects/${f.project}/releases`).expect(200);
    expect(listed.body.data).toMatchObject([{ tagName: 'v0.9.0', repository: 'acme-org/api' }]);
    const releaseId = listed.body.data[0].id as string;

    // Members can't manage milestones.
    expect(
      (await f.dev.browser.post(`/api/v1/milestones/${m.id}/releases`).send({ releaseId })).status,
    ).toBe(403);

    const linked = await f.admin.browser
      .post(`/api/v1/milestones/${m.id}/releases`)
      .send({ releaseId })
      .expect(201);
    expect(linked.body.data.milestone.releases).toMatchObject([
      { tagName: 'v0.9.0', source: 'MANUAL' },
    ]);
    expect(linked.body.data.milestone.status).toBe('PLANNED');

    await f.admin.browser.delete(`/api/v1/milestones/${m.id}/releases/${releaseId}`).expect(200);
    expect(await releasesOf(f, 'Beta')).toEqual([]);
    await f.admin.browser.delete(`/api/v1/milestones/${m.id}/releases/${releaseId}`).expect(404);

    const feed = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity?limit=50`);
    const actions = (feed.body.data as { action: string }[])
      .map((e) => e.action)
      .filter((a) => a.startsWith('milestone.release'));
    expect(actions).toEqual(['milestone.release_unlinked', 'milestone.release_linked']);
  });

  it("refuses releases from repositories that aren't connected to the project", async () => {
    const f = await githubFixture(t);
    const m = await milestone(f, 'Beta');
    await deliver(t, 'release', release('v0.9.0')).expect(202);
    const releaseId = (await t.db.select().from(githubReleases))[0]!.id;

    // Disconnecting the repository takes its releases out of the project.
    await f.owner.browser
      .delete(`/api/v1/projects/${f.project}/repositories/${f.repositoryId}`)
      .expect(204);
    expect(
      (await f.dev.browser.get(`/api/v1/projects/${f.project}/releases`).expect(200)).body.data,
    ).toEqual([]);
    expect(
      (await f.admin.browser.post(`/api/v1/milestones/${m.id}/releases`).send({ releaseId }))
        .status,
    ).toBe(404);
  });
});

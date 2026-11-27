import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, type TestApp } from './utils/test-app';

/** Decision record 0027: the workspace overview of deliveries in flight. */
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

type Fixture = Awaited<ReturnType<typeof projectFixture>>;

async function milestone(f: Fixture, project: string, body: Record<string, unknown>) {
  return (
    await f.admin.browser.post(`/api/v1/projects/${project}/milestones`).send(body).expect(201)
  ).body.data.milestone.id as string;
}

const overview = (u: Fixture['owner'], ws: string) =>
  u.browser.get(`/api/v1/workspaces/${ws}/overview`);

type Overview = {
  sections: {
    stage: string;
    projects: {
      project: { key: string };
      milestones: { name: string; taskCounts: { total: number; done: number } }[];
    }[];
  }[];
};
const shape = (o: Overview) =>
  o.sections.map((s) => [
    s.stage,
    s.projects.map((g) => [g.project.key, g.milestones.map((m) => m.name)]),
  ]);

describe('workspace overview (0027)', () => {
  it('shows admins every unarchived project’s undelivered milestones, by stage', async () => {
    const f = await projectFixture(t);
    const other = (
      await f.owner.browser
        .post(`/api/v1/workspaces/${f.ws}/projects`)
        .send({ name: 'Mobile app', key: 'MOB', internalTriage: false })
        .expect(201)
    ).body.data.project.id as string;
    const gone = (
      await f.owner.browser
        .post(`/api/v1/workspaces/${f.ws}/projects`)
        .send({ name: 'Old site', key: 'OLD', internalTriage: false })
        .expect(201)
    ).body.data.project.id as string;

    await milestone(f, f.project, { name: 'Later', status: 'ACTIVE', dueDate: '2099-01-01' });
    await milestone(f, f.project, { name: 'Late', status: 'ACTIVE', dueDate: '2020-01-01' });
    await milestone(f, f.project, { name: 'Undated', status: 'ACTIVE' });
    const beta = await milestone(f, f.project, { name: 'Beta', status: 'PLANNED' });
    await milestone(f, f.project, { name: 'Shipped', status: 'DELIVERED' });
    await milestone(f, other, { name: 'App review', status: 'CLIENT_REVIEW' });
    await milestone(f, gone, { name: 'Hidden', status: 'ACTIVE' });
    await f.owner.browser.delete(`/api/v1/projects/${gone}`).expect(204);

    await f.dev.browser
      .post(`/api/v1/projects/${f.project}/tasks`)
      .send({ title: 'Beta work', milestoneId: beta, status: 'DONE' })
      .expect(201);

    const res = await overview(f.admin, f.ws).expect(200);
    expect(shape(res.body.data)).toEqual([
      ['ACTIVE', [['DEV', ['Late', 'Later', 'Undated']]]],
      ['CLIENT_REVIEW', [['MOB', ['App review']]]],
      ['PLANNED', [['DEV', ['Beta']]]],
    ]);
    const planned = res.body.data.sections[2].projects[0].milestones[0];
    expect(planned.taskCounts).toMatchObject({ total: 1, done: 1 });
  });

  it('shows leads only their projects, refuses members, and hides it from outsiders', async () => {
    const f = await projectFixture(t);
    await milestone(f, f.project, { name: 'v1', status: 'ACTIVE' });
    const other = (
      await f.owner.browser
        .post(`/api/v1/workspaces/${f.ws}/projects`)
        .send({ name: 'Mobile app', key: 'MOB', internalTriage: false })
        .expect(201)
    ).body.data.project.id as string;
    await milestone(f, other, { name: 'Not theirs', status: 'ACTIVE' });

    const canSee = async (u: Fixture['owner']) =>
      (await u.browser.get(`/api/v1/workspaces/${f.ws}`).expect(200)).body.data.workspace
        .viewerCanSeeOverview as boolean;

    expect(await canSee(f.dev)).toBe(false);
    expect((await overview(f.dev, f.ws)).status).toBe(403);
    expect((await overview(f.outsider, f.ws)).status).toBe(404);
    expect(await canSee(f.admin)).toBe(true);

    await f.owner.browser
      .patch(`/api/v1/projects/${f.project}/members/${f.dev.id}`)
      .send({ role: 'lead' })
      .expect(200);
    expect(await canSee(f.dev)).toBe(true);
    const listed = (await f.dev.browser.get('/api/v1/workspaces').expect(200)).body.data;
    expect(listed.find((w: { id: string }) => w.id === f.ws).viewerCanSeeOverview).toBe(true);
    expect(shape((await overview(f.dev, f.ws).expect(200)).body.data)).toEqual([
      ['ACTIVE', [['DEV', ['v1']]]],
    ]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, verifiedUser, type TestApp } from './utils/test-app';

/** Decision record 0023 §2: project leads. */
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

type U = Awaited<ReturnType<typeof verifiedUser>>;

async function join(owner: U, ws: string, user: U, role: 'ADMIN' | 'MEMBER') {
  await owner.browser
    .post(`/api/v1/workspaces/${ws}/invitations`)
    .send({ email: user.email, role })
    .expect(201);
  const token = t.mailer.lastToken(user.email, 'invited you');
  await user.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
}

/**
 * Owner, admin, `lead` and `dev` (Members on project DEV), and `bystander` (Member, not on DEV).
 * The owner created DEV and a second project OPS that only the owner belongs to.
 */
async function setup() {
  const [owner, admin, lead, dev, bystander] = await Promise.all(
    ['owner', 'admin', 'lead', 'dev', 'bystander'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id as string;
  await join(owner!, ws, admin!, 'ADMIN');
  await join(owner!, ws, lead!, 'MEMBER');
  await join(owner!, ws, dev!, 'MEMBER');
  await join(owner!, ws, bystander!, 'MEMBER');
  const create = async (name: string, key: string) =>
    (await owner!.browser.post(`/api/v1/workspaces/${ws}/projects`).send({ name, key }).expect(201))
      .body.data.project.id as string;
  const project = await create('Developer Platform', 'DEV');
  const other = await create('Operations', 'OPS');
  for (const u of [lead!, dev!]) {
    await owner!.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: u.id })
      .expect(201);
  }
  return {
    owner: owner!,
    admin: admin!,
    lead: lead!,
    dev: dev!,
    bystander: bystander!,
    ws,
    project,
    other,
  };
}

const setRole = (actor: U, project: string, userId: string, role: 'lead' | 'member') =>
  actor.browser.patch(`/api/v1/projects/${project}/members/${userId}`).send({ role });

const roles = async (actor: U, project: string) =>
  Object.fromEntries(
    (
      (await actor.browser.get(`/api/v1/projects/${project}/members`).expect(200)).body.data as {
        user: { username: string };
        role: string;
      }[]
    ).map((m) => [m.user.username, m.role]),
  );

describe('appointing project leads', () => {
  it('lets Owners and Admins appoint and un-appoint leads, and nobody else', async () => {
    const { owner, admin, lead, dev, bystander, project } = await setup();

    expect(await roles(dev, project)).toEqual({ owner: 'member', lead: 'member', dev: 'member' });

    await setRole(owner, project, lead.id, 'lead').expect(200);
    expect(await roles(dev, project)).toMatchObject({ lead: 'lead', dev: 'member' });

    // A lead can't appoint others, and neither can a plain member.
    expect((await setRole(lead, project, dev.id, 'lead')).status).toBe(403);
    expect((await setRole(dev, project, dev.id, 'lead')).status).toBe(403);

    await setRole(admin, project, lead.id, 'member').expect(200);
    expect(await roles(dev, project)).toMatchObject({ lead: 'member' });

    // Someone who isn't on the project can't be appointed.
    expect((await setRole(owner, project, bystander.id, 'lead')).status).toBe(404);
    expect((await setRole(owner, project, owner.id, 'boss' as 'lead')).status).toBe(400);
  });
});

describe('what a project lead can do', () => {
  it('lets a lead change the project, its milestones and its request form', async () => {
    const { owner, lead, dev, ws, project } = await setup();
    const p = `/api/v1/projects/${project}`;

    // Before the appointment, a member can't.
    expect((await lead.browser.patch(p).send({ name: 'Platform' })).status).toBe(403);
    await setRole(owner, project, lead.id, 'lead').expect(200);

    await lead.browser.patch(p).send({ name: 'Platform' }).expect(200);
    await lead.browser.post(`${p}/milestones`).send({ name: 'Beta' }).expect(201);
    const intake = await lead.browser.put(`${p}/intake`).send({ enabled: true }).expect(200);
    expect(intake.body.data.intake.enabled).toBe(true);

    const view = (await lead.browser.get(p).expect(200)).body.data.project;
    expect(view).toMatchObject({
      name: 'Platform',
      viewerCanManage: true,
      viewerCanManageMembers: false,
      leads: [{ id: lead.id, username: 'lead' }],
    });
    expect(view.intake.enabled).toBe(true);
    const listed = (await lead.browser.get(`/api/v1/workspaces/${ws}/projects`).expect(200)).body
      .data;
    expect(listed).toMatchObject([
      { id: project, viewerCanManage: true, leads: [{ username: 'lead' }] },
    ]);
    const ownerView = (await owner.browser.get(p).expect(200)).body.data.project;
    expect(ownerView.viewerCanManageMembers).toBe(true);

    // A plain member still can't.
    expect((await dev.browser.patch(p).send({ name: 'Mine' })).status).toBe(403);
    expect((await dev.browser.get(p).expect(200)).body.data.project.viewerCanManage).toBe(false);
  });
});

describe('what stays with Owners and Admins', () => {
  it('refuses a lead archiving, managing people, linking repositories and appointing', async () => {
    const { owner, lead, dev, bystander, project } = await setup();
    const p = `/api/v1/projects/${project}`;
    await setRole(owner, project, lead.id, 'lead').expect(200);

    expect((await lead.browser.delete(p)).status).toBe(403);
    expect((await lead.browser.post(`${p}/members`).send({ userId: bystander.id })).status).toBe(
      403,
    );
    expect((await lead.browser.delete(`${p}/members/${dev.id}`)).status).toBe(403);
    expect((await setRole(lead, project, dev.id, 'lead')).status).toBe(403);
    expect(
      (
        await lead.browser
          .post(`${p}/repositories`)
          .send({ connectionId: '00000000-0000-4000-8000-000000000000', githubRepositoryId: 1 })
      ).status,
    ).toBe(403);

    // Nothing changed.
    expect((await owner.browser.get(p).expect(200)).body.data.project.status).not.toBe('ARCHIVED');
    expect(await roles(owner, project)).toEqual({ owner: 'member', lead: 'lead', dev: 'member' });
  });
});

describe('a lead manages only their own project', () => {
  it("doesn't open other projects or show tasks from them", async () => {
    const { owner, lead, ws, project, other } = await setup();
    await setRole(owner, project, lead.id, 'lead').expect(200);

    expect((await lead.browser.get(`/api/v1/projects/${other}`)).status).toBe(404);
    expect((await lead.browser.patch(`/api/v1/projects/${other}`).send({ name: 'X' })).status).toBe(
      404,
    );
    const listed = (await lead.browser.get(`/api/v1/workspaces/${ws}/projects`).expect(200)).body
      .data as { id: string }[];
    expect(listed.map((p) => p.id)).toEqual([project]);

    // A relation the owner made into OPS stays hidden from the DEV lead.
    const task = async (p: string, title: string) =>
      (await owner.browser.post(`/api/v1/projects/${p}/tasks`).send({ title }).expect(201)).body
        .data.task as { id: string; key: string };
    const mine = await task(project, 'Ship it');
    const theirs = await task(other, 'Secret ops work');
    await owner.browser
      .post(`/api/v1/tasks/${mine.id}/relations`)
      .send({ kind: 'RELATES', taskId: theirs.id })
      .expect(201);
    const seen = await lead.browser.get(`/api/v1/tasks/${mine.id}/relations`).expect(200);
    expect(seen.body.data.relations).toEqual([]);
    const ownerSees = await owner.browser.get(`/api/v1/tasks/${mine.id}/relations`).expect(200);
    expect(ownerSees.body.data.relations).toHaveLength(1);
  });
});

describe('leaving a project', () => {
  it('drops the lead role, so someone added back is a plain member', async () => {
    const { owner, lead, project } = await setup();
    const p = `/api/v1/projects/${project}`;
    await setRole(owner, project, lead.id, 'lead').expect(200);

    await owner.browser.delete(`${p}/members/${lead.id}`).expect(204);
    expect((await lead.browser.get(p)).status).toBe(404);
    await owner.browser.post(`${p}/members`).send({ userId: lead.id }).expect(201);

    expect((await roles(owner, project)).lead).toBe('member');
    expect((await lead.browser.patch(p).send({ name: 'Mine' })).status).toBe(403);
  });
});

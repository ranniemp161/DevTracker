import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, TEST_PROXY_SECRET, verifiedUser, type TestApp } from './utils/test-app';

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
    (
      await owner!.browser
        .post(`/api/v1/workspaces/${ws}/projects`)
        .send({ internalTriage: false, name, key })
        .expect(201)
    ).body.data.project.id as string;
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

/** Turns DEV's request form on and sends one bug report; returns its title. */
async function sendRequest(owner: U, project: string, title: string, ip = '203.0.113.1') {
  const form = await owner.browser
    .put(`/api/v1/projects/${project}/intake`)
    .send({ enabled: true })
    .expect(200);
  await t
    .http()
    .post(`/api/v1/public/requests/${form.body.data.intake.token}`)
    .set('x-devtrack-client-ip', ip)
    .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
    .send({ kind: 'bug', title })
    .expect(202);
  return title;
}

const openRequests = (u: U, project: string) =>
  u.browser.get(`/api/v1/projects/${project}/requests`);

describe('triage once a project has a lead (0023 §4)', () => {
  it('lets every member triage until a lead is appointed, then only leads and admins', async () => {
    const { owner, lead, dev, project } = await setup();
    await sendRequest(owner, project, 'First bug');
    await sendRequest(owner, project, 'Second bug', '203.0.113.2');
    await sendRequest(owner, project, 'Third bug', '203.0.113.3');
    const ids = Object.fromEntries(
      (
        (await openRequests(owner, project).expect(200)).body.data as {
          id: string;
          task: { title: string };
        }[]
      ).map((r) => [r.task.title, r.id]),
    );

    // No leads: a developer triages, as in 0016.
    await openRequests(dev, project).expect(200);
    await dev.browser
      .post(`/api/v1/requests/${ids['First bug']}/accept`)
      .send({ milestoneId: null })
      .expect(204);

    // A lead is appointed: now only the lead (and admins) triage.
    await setRole(owner, project, lead.id, 'lead').expect(200);
    expect((await openRequests(dev, project)).status).toBe(403);
    expect(
      (
        await dev.browser
          .post(`/api/v1/requests/${ids['Second bug']}/accept`)
          .send({ milestoneId: null })
      ).status,
    ).toBe(403);
    expect((await dev.browser.post(`/api/v1/requests/${ids['Second bug']}/decline`)).status).toBe(
      403,
    );
    await openRequests(lead, project).expect(200);
    await lead.browser
      .post(`/api/v1/requests/${ids['Second bug']}/accept`)
      .send({ milestoneId: null })
      .expect(204);

    // The last lead steps down: everyone triages again.
    await setRole(owner, project, lead.id, 'member').expect(200);
    await dev.browser.post(`/api/v1/requests/${ids['Third bug']}/decline`).expect(204);
  });
});

describe('viewerCanTriage (0023 §4)', () => {
  it('follows the lead rule on the project and in the project list', async () => {
    const { owner, lead, dev, ws, project } = await setup();
    const flag = async (u: U) => {
      const one = (await u.browser.get(`/api/v1/projects/${project}`).expect(200)).body.data.project
        .viewerCanTriage;
      const listed = (
        (await u.browser.get(`/api/v1/workspaces/${ws}/projects`).expect(200)).body.data as {
          id: string;
          viewerCanTriage: boolean;
        }[]
      ).find((p) => p.id === project)!.viewerCanTriage;
      expect(listed).toBe(one);
      return one;
    };

    expect([await flag(owner), await flag(lead), await flag(dev)]).toEqual([true, true, true]);
    await setRole(owner, project, lead.id, 'lead').expect(200);
    expect([await flag(owner), await flag(lead), await flag(dev)]).toEqual([true, true, false]);
  });
});

describe('who hears about new requests (0023 §4)', () => {
  it('tells Owners and Admins while there are no leads, and only the leads once there are', async () => {
    const { owner, admin, lead, dev, project } = await setup();
    const told = async (u: U) =>
      (
        (await u.browser.get('/api/v1/notifications').expect(200)).body.data as {
          type: string;
          title: string;
        }[]
      )
        .filter((n) => n.type === 'REQUEST_SUBMITTED')
        .map((n) => n.title);

    await sendRequest(owner, project, 'Before a lead');
    await setRole(owner, project, lead.id, 'lead').expect(200);
    await sendRequest(owner, project, 'After a lead', '203.0.113.2');

    const before = 'New bug report in DEV: Before a lead';
    const after = 'New bug report in DEV: After a lead';
    expect(await told(owner)).toEqual([before]);
    expect(await told(admin)).toEqual([before]);
    expect(await told(lead)).toEqual([after]);
    expect(await told(dev)).toEqual([]);
  });
});

const blockedNotes = async (u: U) =>
  (
    (await u.browser.get('/api/v1/notifications').expect(200)).body.data as {
      type: string;
      title: string;
      body: string | null;
      link: string | null;
    }[]
  ).filter((n) => n.type === 'TASK_BLOCKED');

const newTask = async (u: U, project: string, title: string) =>
  (await u.browser.post(`/api/v1/projects/${project}/tasks`).send({ title }).expect(201)).body.data
    .task as { id: string; key: string };

const moveTo = (u: U, taskId: string, status: string) =>
  u.browser.patch(`/api/v1/tasks/${taskId}/status`).send({ status }).expect(200);

describe('blocked tasks reach the lead (0023 §6)', () => {
  it('tells the leads, or the admins when there are none, but never the person who moved it', async () => {
    const { owner, admin, lead, dev, project } = await setup();

    // No leads: the workspace's Owner and Admin hear about it.
    const first = await newTask(dev, project, 'Waiting on the API key');
    await moveTo(dev, first.id, 'BLOCKED');
    expect((await blockedNotes(owner)).map((n) => n.title)).toEqual([
      `@dev marked ${first.key} as blocked`,
    ]);
    expect(await blockedNotes(admin)).toHaveLength(1);

    // With a lead: only the lead does.
    await setRole(owner, project, lead.id, 'lead').expect(200);
    const second = await newTask(dev, project, 'Waiting on design');
    await moveTo(dev, second.id, 'BLOCKED');
    expect(await blockedNotes(lead)).toMatchObject([
      {
        type: 'TASK_BLOCKED',
        title: `@dev marked ${second.key} as blocked`,
        body: 'Waiting on design',
        link: `/projects/${project}/tasks/${second.id}`,
      },
    ]);
    expect(await blockedNotes(owner)).toHaveLength(1);
    expect(await blockedNotes(dev)).toEqual([]);

    // A lead who blocks a task themselves isn't told.
    const third = await newTask(lead, project, 'Lead blocks it');
    await moveTo(lead, third.id, 'BLOCKED');
    expect(await blockedNotes(lead)).toHaveLength(1);
  });
});

describe('blocking tasks in bulk (0023 §6)', () => {
  it('tells the lead once per task', async () => {
    const { owner, lead, dev, project } = await setup();
    await setRole(owner, project, lead.id, 'lead').expect(200);
    const a = await newTask(dev, project, 'Bulk one');
    const b = await newTask(dev, project, 'Bulk two');

    await dev.browser
      .patch(`/api/v1/projects/${project}/tasks/bulk`)
      .send({ taskIds: [a.id, b.id], status: 'BLOCKED' })
      .expect(200);
    expect((await blockedNotes(lead)).map((n) => n.body).sort()).toEqual(['Bulk one', 'Bulk two']);
  });
});

describe('blocking the same task again (0023 §6)', () => {
  it('sends one notification an hour per task', async () => {
    const { owner, lead, dev, project } = await setup();
    await setRole(owner, project, lead.id, 'lead').expect(200);
    const task = await newTask(dev, project, 'Flaky dependency');

    await moveTo(dev, task.id, 'BLOCKED');
    await moveTo(dev, task.id, 'IN_PROGRESS');
    await moveTo(dev, task.id, 'BLOCKED');
    expect(await blockedNotes(lead)).toHaveLength(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 61 * 60 * 1000);
      await moveTo(dev, task.id, 'IN_PROGRESS');
      await moveTo(dev, task.id, 'BLOCKED');
    } finally {
      vi.useRealTimers();
    }
    expect(await blockedNotes(lead)).toHaveLength(2);
  });
});

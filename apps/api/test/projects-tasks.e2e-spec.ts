import { projectMembers, taskAssignees, tasks } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, verifiedUser, type TestApp } from './utils/test-app';

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
 * Workspace with owner, admin, `dev` (Member, on the project), `bystander` (Member, not on the
 * project) and an `outsider` (not in the workspace). The owner created project DEV.
 */
async function setup() {
  const [owner, admin, dev, bystander, outsider] = await Promise.all(
    ['owner', 'admin', 'dev', 'bystander', 'outsider'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id;
  await join(owner!, ws, admin!, 'ADMIN');
  await join(owner!, ws, dev!, 'MEMBER');
  await join(owner!, ws, bystander!, 'MEMBER');
  const created = await owner!.browser.post(`/api/v1/workspaces/${ws}/projects`).send({
    name: 'Developer Platform',
    key: 'dev',
    startDate: '2026-11-01',
    targetDate: '2026-12-31',
  });
  expect(created.status).toBe(201);
  const project = created.body.data.project.id as string;
  await owner!.browser
    .post(`/api/v1/projects/${project}/members`)
    .send({ userId: dev!.id })
    .expect(201);
  return {
    owner: owner!,
    admin: admin!,
    dev: dev!,
    bystander: bystander!,
    outsider: outsider!,
    ws,
    project,
  };
}

const createTask = (u: U, project: string, body: Record<string, unknown> = {}) =>
  u.browser.post(`/api/v1/projects/${project}/tasks`).send({ title: 'A task', ...body });

describe('projects', () => {
  it('creates a project with an upper-cased key; the creator becomes a member', async () => {
    const { owner, project } = await setup();
    const res = await owner.browser.get(`/api/v1/projects/${project}`).expect(200);
    expect(res.body.data.project).toMatchObject({
      key: 'DEV',
      status: 'PLANNING',
      startDate: '2026-11-01',
      memberCount: 2,
      viewerCanManage: true,
      createdBy: { username: 'owner' },
    });
  });

  it('rejects duplicate keys within a workspace, but allows them across workspaces', async () => {
    const { owner, ws, outsider } = await setup();
    const dup = await owner.browser
      .post(`/api/v1/workspaces/${ws}/projects`)
      .send({ name: 'Other', key: 'DEV' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PROJECT_KEY_TAKEN');

    const ws2 = (await outsider.browser.post('/api/v1/workspaces').send({ name: 'Other Co' })).body
      .data.workspace.id;
    await outsider.browser
      .post(`/api/v1/workspaces/${ws2}/projects`)
      .send({ name: 'Dev', key: 'DEV' })
      .expect(201);
  });

  it('only lets workspace admins create projects', async () => {
    const { dev, admin, ws } = await setup();
    expect(
      (await dev.browser.post(`/api/v1/workspaces/${ws}/projects`).send({ name: 'X', key: 'XX' }))
        .status,
    ).toBe(403);
    expect(
      (await admin.browser.post(`/api/v1/workspaces/${ws}/projects`).send({ name: 'X', key: 'XX' }))
        .status,
    ).toBe(201);
  });

  it('shows Members only their projects; admins see all; outsiders get 404', async () => {
    const { admin, dev, bystander, outsider, ws, project } = await setup();
    const list = async (u: U) =>
      (await u.browser.get(`/api/v1/workspaces/${ws}/projects`)).body.data;

    expect((await list(admin)).map((p: { key: string }) => p.key)).toEqual(['DEV']);
    expect((await list(dev)).map((p: { viewerCanManage: boolean }) => p.viewerCanManage)).toEqual([
      false,
    ]);
    expect(await list(bystander)).toEqual([]);
    expect((await bystander.browser.get(`/api/v1/projects/${project}`)).status).toBe(404);
    expect((await outsider.browser.get(`/api/v1/projects/${project}`)).status).toBe(404);
    expect((await outsider.browser.get(`/api/v1/workspaces/${ws}/projects`)).status).toBe(404);
  });

  it('lets admins update; validates dates against stored values; members cannot update', async () => {
    const { admin, dev, project } = await setup();
    expect(
      (await dev.browser.patch(`/api/v1/projects/${project}`).send({ name: 'X' })).status,
    ).toBe(403);

    const bad = await admin.browser
      .patch(`/api/v1/projects/${project}`)
      .send({ targetDate: '2026-10-01' });
    expect(bad.status).toBe(400);

    const ok = await admin.browser
      .patch(`/api/v1/projects/${project}`)
      .send({ name: 'Platform', status: 'ACTIVE', description: 'Core services' });
    expect(ok.body.data.project).toMatchObject({ name: 'Platform', status: 'ACTIVE', key: 'DEV' });

    expect(
      (await admin.browser.patch(`/api/v1/projects/${project}`).send({ status: 'ARCHIVED' }))
        .status,
    ).toBe(400);
    expect(
      (await admin.browser.patch(`/api/v1/projects/${project}`).send({ key: 'NEW' })).status,
    ).toBe(400);
  });

  it('archives on DELETE; archived projects are read-only and hidden by default', async () => {
    const { owner, admin, dev, ws, project } = await setup();
    const task = (await createTask(dev, project)).body.data.task.id;

    expect((await dev.browser.delete(`/api/v1/projects/${project}`)).status).toBe(403);
    expect((await admin.browser.delete(`/api/v1/projects/${project}`)).status).toBe(204);

    expect((await owner.browser.get(`/api/v1/workspaces/${ws}/projects`)).body.data).toEqual([]);
    const all = await owner.browser.get(`/api/v1/workspaces/${ws}/projects?includeArchived=true`);
    expect(all.body.data[0].status).toBe('ARCHIVED');

    // Still readable, but no writes.
    await dev.browser.get(`/api/v1/projects/${project}/tasks`).expect(200);
    for (const res of [
      await createTask(dev, project),
      await dev.browser.patch(`/api/v1/tasks/${task}`).send({ title: 'x' }),
      await admin.browser.patch(`/api/v1/projects/${project}`).send({ name: 'x' }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
  });
});

describe('project members', () => {
  it('admins add workspace members only; duplicates and outsiders are rejected', async () => {
    const { admin, dev, bystander, outsider, project } = await setup();
    expect(
      (await dev.browser.post(`/api/v1/projects/${project}/members`).send({ userId: bystander.id }))
        .status,
    ).toBe(403);

    const notInWs = await admin.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: outsider.id });
    expect(notInWs.body.error.code).toBe('NOT_WORKSPACE_MEMBER');

    const added = await admin.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: bystander.id });
    expect(added.status).toBe(201);
    expect(added.body.data.member.user.username).toBe('bystander');
    await bystander.browser.get(`/api/v1/projects/${project}`).expect(200);

    const dup = await admin.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: bystander.id });
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');

    const members = await dev.browser.get(`/api/v1/projects/${project}/members`).expect(200);
    expect(members.body.data.map((m: { user: { username: string } }) => m.user.username)).toEqual([
      'bystander',
      'dev',
      'owner',
    ]);
  });

  it('removing a project member revokes access and unassigns their tasks', async () => {
    const { admin, dev, project } = await setup();
    const task = (await createTask(admin, project, { assigneeIds: [dev.id] })).body.data.task.id;
    await admin.browser.delete(`/api/v1/projects/${project}/members/${dev.id}`).expect(204);

    expect((await dev.browser.get(`/api/v1/projects/${project}`)).status).toBe(404);
    expect((await dev.browser.get(`/api/v1/tasks/${task}`)).status).toBe(404);
    expect((await admin.browser.get(`/api/v1/tasks/${task}`)).body.data.task.assignees).toEqual([]);
  });

  it('removing a workspace member removes their project memberships and assignments', async () => {
    const { owner, admin, dev, ws, project } = await setup();
    await createTask(admin, project, { assigneeIds: [dev.id] }).expect(201);
    await owner.browser.delete(`/api/v1/workspaces/${ws}/members/${dev.id}`).expect(204);

    const rows = await t.db.select().from(projectMembers);
    expect(rows.some((r) => r.userId === dev.id)).toBe(false);
    expect((await t.db.select().from(taskAssignees)).some((r) => r.userId === dev.id)).toBe(false);
  });
});

describe('tasks', () => {
  it('creates tasks with sequential human-readable keys', async () => {
    const { dev, project } = await setup();
    const first = await createTask(dev, project, {
      title: 'First',
      priority: 'HIGH',
      dueDate: '2026-11-20',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.task).toMatchObject({
      number: 1,
      key: 'DEV-1',
      title: 'First',
      status: 'TODO',
      priority: 'HIGH',
      dueDate: '2026-11-20',
      reporter: { username: 'dev' },
      assignees: [],
      completedAt: null,
    });
    expect((await createTask(dev, project)).body.data.task.key).toBe('DEV-2');
  });

  it('allocates unique numbers under concurrent creation and never reuses them', async () => {
    const { dev, admin, project } = await setup();
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => createTask(i % 2 ? dev : admin, project)),
    );
    const numbers = results
      .map((r) => r.body.data.task.number)
      .sort((a: number, b: number) => a - b);
    expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));

    // Deleting the newest task does not free its number.
    const last = results.find((r) => r.body.data.task.number === 15)!.body.data.task.id;
    await admin.browser.delete(`/api/v1/tasks/${last}`).expect(204);
    expect((await createTask(dev, project)).body.data.task.number).toBe(16);
  });

  it('sets completedAt on DONE and clears it when reopened', async () => {
    const { dev, project } = await setup();
    const id = (await createTask(dev, project)).body.data.task.id;
    const done = await dev.browser.patch(`/api/v1/tasks/${id}/status`).send({ status: 'DONE' });
    expect(done.body.data.task.completedAt).toEqual(expect.any(String));
    const reopened = await dev.browser.patch(`/api/v1/tasks/${id}`).send({ status: 'IN_REVIEW' });
    expect(reopened.body.data.task).toMatchObject({ status: 'IN_REVIEW', completedAt: null });
    const created = await createTask(dev, project, { status: 'DONE' });
    expect(created.body.data.task.completedAt).toEqual(expect.any(String));
  });

  it('updates fields, clears the due date, and rejects empty updates', async () => {
    const { dev, project } = await setup();
    const id = (await createTask(dev, project, { dueDate: '2026-11-20' })).body.data.task.id;
    const res = await dev.browser
      .patch(`/api/v1/tasks/${id}`)
      .send({ title: 'Renamed', description: 'Details', priority: 'URGENT', dueDate: null });
    expect(res.body.data.task).toMatchObject({
      title: 'Renamed',
      description: 'Details',
      priority: 'URGENT',
      dueDate: null,
    });
    expect((await dev.browser.patch(`/api/v1/tasks/${id}`).send({})).status).toBe(400);
  });

  it('only assigns project members', async () => {
    const { dev, admin, bystander, project } = await setup();
    const bad = await createTask(dev, project, { assigneeIds: [bystander.id] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('NOT_PROJECT_MEMBER');

    const id = (await createTask(dev, project)).body.data.task.id;
    const added = await dev.browser
      .post(`/api/v1/tasks/${id}/assignees`)
      .send({ userIds: [dev.id, admin.id] });
    // admin is a workspace admin but not a project member.
    expect(added.body.error?.code).toBe('NOT_PROJECT_MEMBER');

    const ok = await dev.browser.post(`/api/v1/tasks/${id}/assignees`).send({ userIds: [dev.id] });
    expect(ok.body.data.task.assignees.map((a: { username: string }) => a.username)).toEqual([
      'dev',
    ]);
    // Adding again is idempotent.
    await dev.browser
      .post(`/api/v1/tasks/${id}/assignees`)
      .send({ userIds: [dev.id] })
      .expect(200);

    const removed = await dev.browser.delete(`/api/v1/tasks/${id}/assignees/${dev.id}`);
    expect(removed.body.data.task.assignees).toEqual([]);
    expect((await dev.browser.delete(`/api/v1/tasks/${id}/assignees/${dev.id}`)).status).toBe(404);
  });

  it('soft-deletes: reporter or admin only; deleted tasks disappear', async () => {
    const { owner, dev, project } = await setup();
    await owner.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: owner.id })
      .expect(409);
    const byOwner = (await createTask(owner, project)).body.data.task.id;
    const byDev = (await createTask(dev, project)).body.data.task.id;

    expect((await dev.browser.delete(`/api/v1/tasks/${byOwner}`)).status).toBe(403);
    expect((await dev.browser.delete(`/api/v1/tasks/${byDev}`)).status).toBe(204);
    expect((await owner.browser.delete(`/api/v1/tasks/${byOwner}`)).status).toBe(204);

    expect((await dev.browser.get(`/api/v1/tasks/${byDev}`)).status).toBe(404);
    expect((await dev.browser.get(`/api/v1/projects/${project}/tasks`)).body.data).toEqual([]);
    const rows = await t.db.select().from(tasks);
    expect(rows.every((r) => r.deletedAt !== null)).toBe(true); // rows retained
  });

  it('lists newest first with cursor pagination and filters', async () => {
    const { dev, project } = await setup();
    for (let i = 1; i <= 5; i++) {
      await createTask(dev, project, {
        title: `Task ${i}`,
        status: i % 2 ? 'TODO' : 'DONE',
        priority: i === 5 ? 'URGENT' : 'LOW',
        assigneeIds: i === 3 ? [dev.id] : [],
      }).expect(201);
    }
    const page1 = await dev.browser.get(`/api/v1/projects/${project}/tasks?limit=2`);
    expect(page1.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-5', 'DEV-4']);
    expect(page1.body.meta).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });

    const page2 = await dev.browser.get(
      `/api/v1/projects/${project}/tasks?limit=2&cursor=${page1.body.meta.nextCursor}`,
    );
    expect(page2.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-3', 'DEV-2']);
    const page3 = await dev.browser.get(
      `/api/v1/projects/${project}/tasks?limit=2&cursor=${page2.body.meta.nextCursor}`,
    );
    expect(page3.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-1']);
    expect(page3.body.meta).toMatchObject({ hasMore: false, nextCursor: null });

    const filter = async (q: string) =>
      (await dev.browser.get(`/api/v1/projects/${project}/tasks?${q}`)).body.data.map(
        (x: { key: string }) => x.key,
      );
    expect(await filter('status=DONE')).toEqual(['DEV-4', 'DEV-2']);
    expect(await filter('priority=URGENT')).toEqual(['DEV-5']);
    expect(await filter(`assigneeId=${dev.id}`)).toEqual(['DEV-3']);

    expect((await dev.browser.get(`/api/v1/projects/${project}/tasks?cursor=garbage`)).status).toBe(
      400,
    );
    expect((await dev.browser.get(`/api/v1/projects/${project}/tasks?status=NOPE`)).status).toBe(
      400,
    );
  });

  it('searches by title, description and key, combined with filters and pagination', async () => {
    const { dev, bystander, project } = await setup();
    const seed = [
      { title: 'Fix login redirect', status: 'TODO' },
      { title: 'Billing page', description: 'Login button overlaps the logo', status: 'DONE' },
      { title: 'Release v12 notes', status: 'TODO' },
      { title: '50% discount banner', status: 'TODO' },
      { title: '500 error on signup', status: 'TODO' },
      { title: 'LOGIN rate limit', status: 'TODO' },
    ];
    for (const body of seed) await createTask(dev, project, body).expect(201);

    const search = async (q: string) =>
      (
        await dev.browser.get(`/api/v1/projects/${project}/tasks?q=${encodeURIComponent(q)}`)
      ).body.data.map((x: { key: string }) => x.key);

    expect(await search('login')).toEqual(['DEV-6', 'DEV-2', 'DEV-1']);
    expect(await search('DEV-3')).toEqual(['DEV-3']);
    expect(await search('dev-3')).toEqual(['DEV-3']);
    expect(await search('#2')).toEqual(['DEV-2']);
    // A bare number matches the task number or text containing it.
    expect(await search('12')).toEqual(['DEV-3']);
    expect(await search('5')).toEqual(['DEV-5', 'DEV-4']);
    // Wildcards are literal: "50%" must not match "500 error".
    expect(await search('50%')).toEqual(['DEV-4']);
    expect(await search('_')).toEqual([]);
    // Another project's key is plain text.
    expect(await search('API-3')).toEqual([]);
    expect(await search('   ')).toEqual(['DEV-6', 'DEV-5', 'DEV-4', 'DEV-3', 'DEV-2', 'DEV-1']);

    const combined = await dev.browser.get(`/api/v1/projects/${project}/tasks?q=login&status=TODO`);
    expect(combined.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-6', 'DEV-1']);

    const page1 = await dev.browser.get(`/api/v1/projects/${project}/tasks?q=login&limit=2`);
    expect(page1.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-6', 'DEV-2']);
    const page2 = await dev.browser.get(
      `/api/v1/projects/${project}/tasks?q=login&limit=2&cursor=${page1.body.meta.nextCursor}`,
    );
    expect(page2.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-1']);
    expect(page2.body.meta).toMatchObject({ hasMore: false });

    expect(
      (await dev.browser.get(`/api/v1/projects/${project}/tasks?q=${'a'.repeat(101)}`)).status,
    ).toBe(400);
    expect((await bystander.browser.get(`/api/v1/projects/${project}/tasks?q=login`)).status).toBe(
      404,
    );
  });
});

describe('isolation (architecture §6, §16)', () => {
  it('non-project members and outsiders get 404 on every project and task route', async () => {
    const { dev, bystander, outsider, project } = await setup();
    const task = (await createTask(dev, project)).body.data.task.id;

    for (const attacker of [bystander, outsider]) {
      const checks = [
        () => attacker.browser.get(`/api/v1/projects/${project}`),
        () => attacker.browser.get(`/api/v1/projects/${project}/members`),
        () => attacker.browser.get(`/api/v1/projects/${project}/tasks`),
        () => createTask(attacker, project),
        () => attacker.browser.get(`/api/v1/tasks/${task}`),
        () => attacker.browser.patch(`/api/v1/tasks/${task}`).send({ title: 'pwned' }),
        () => attacker.browser.patch(`/api/v1/tasks/${task}/status`).send({ status: 'DONE' }),
        () => attacker.browser.delete(`/api/v1/tasks/${task}`),
        () =>
          attacker.browser.post(`/api/v1/tasks/${task}/assignees`).send({ userIds: [attacker.id] }),
      ];
      for (const check of checks) expect((await check()).status).toBe(404);
    }
    expect((await dev.browser.get(`/api/v1/tasks/${task}`)).body.data.task.title).toBe('A task');
  });
});

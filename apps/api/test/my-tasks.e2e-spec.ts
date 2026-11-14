import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
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

async function join(owner: U, ws: string, user: U) {
  await owner.browser
    .post(`/api/v1/workspaces/${ws}/invitations`)
    .send({ email: user.email, role: 'MEMBER' })
    .expect(201);
  const token = t.mailer.lastToken(user.email, 'invited you');
  await user.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
}

async function project(owner: U, ws: string, key: string, members: U[]) {
  const id = (
    await owner.browser
      .post(`/api/v1/workspaces/${ws}/projects`)
      .send({ name: `Project ${key}`, key })
      .expect(201)
  ).body.data.project.id as string;
  for (const m of members) {
    await owner.browser.post(`/api/v1/projects/${id}/members`).send({ userId: m.id }).expect(201);
  }
  return id;
}

const task = async (u: U, projectId: string, body: Record<string, unknown>) =>
  (
    await u.browser
      .post(`/api/v1/projects/${projectId}/tasks`)
      .send({ title: 'A task', ...body })
      .expect(201)
  ).body.data.task as { id: string; key: string };

const myTasks = async (u: U, ws: string) => {
  const res = await u.browser.get(`/api/v1/workspaces/${ws}/my-tasks`);
  return {
    status: res.status,
    keys: (res.body.data?.tasks ?? []).map((x: { key: string }) => x.key),
    body: res.body.data,
  };
};

it('lists my open assignments in this workspace, most urgent first, with each project', async () => {
  const [owner, dev, other, outsider] = await Promise.all(
    ['owner', 'dev', 'other', 'outsider'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id as string;
  await join(owner!, ws, dev!);
  await join(owner!, ws, other!);
  const devProject = await project(owner!, ws, 'DEV', [dev!, other!]);
  const opsProject = await project(owner!, ws, 'OPS', [dev!]);

  const me = [dev!.id];
  await task(dev!, devProject, {
    title: 'Due later',
    dueDate: '2026-11-20',
    priority: 'HIGH',
    assigneeIds: me,
  });
  await task(dev!, devProject, { title: 'No date', priority: 'URGENT', assigneeIds: me });
  await task(dev!, devProject, {
    title: 'Due soon, low',
    dueDate: '2026-11-15',
    priority: 'LOW',
    assigneeIds: me,
  });
  await task(dev!, devProject, { title: 'Done', status: 'DONE', assigneeIds: me });
  await task(dev!, devProject, { title: 'Not mine', assigneeIds: [other!.id] });
  const deleted = await task(dev!, devProject, { title: 'Deleted', assigneeIds: me });
  await dev!.browser.delete(`/api/v1/tasks/${deleted.id}`).expect(204);
  await task(dev!, opsProject, {
    title: 'Due soon, urgent',
    dueDate: '2026-11-15',
    priority: 'URGENT',
    assigneeIds: me,
  });

  // Another workspace's assignments stay out.
  const beta = (await dev!.browser.post('/api/v1/workspaces').send({ name: 'Beta' })).body.data
    .workspace.id as string;
  await task(dev!, await project(dev!, beta, 'BET', []), { title: 'Elsewhere', assigneeIds: me });

  const mine = await myTasks(dev!, ws);
  expect(mine.status).toBe(200);
  expect(mine.keys).toEqual(['OPS-1', 'DEV-3', 'DEV-1', 'DEV-2']);
  expect(mine.body.hasMore).toBe(false);
  expect(mine.body.tasks[0].project).toEqual({ id: opsProject, key: 'OPS', name: 'Project OPS' });
  expect(mine.body.tasks[0].assignees.map((a: { id: string }) => a.id)).toEqual([dev!.id]);

  expect((await myTasks(other!, ws)).keys).toEqual(['DEV-5']);
  expect((await myTasks(dev!, beta)).keys).toEqual(['BET-1']);

  // Archived projects drop out.
  await owner!.browser.delete(`/api/v1/projects/${opsProject}`).expect(204);
  expect((await myTasks(dev!, ws)).keys).toEqual(['DEV-3', 'DEV-1', 'DEV-2']);

  // Losing project access drops its tasks.
  await owner!.browser.delete(`/api/v1/projects/${devProject}/members/${dev!.id}`).expect(204);
  expect((await myTasks(dev!, ws)).keys).toEqual([]);

  // Outsiders get the same 404 as for a missing workspace.
  expect((await myTasks(outsider!, ws)).status).toBe(404);
});

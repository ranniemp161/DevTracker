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

async function join(owner: U, ws: string, user: U, role = 'MEMBER') {
  await owner.browser
    .post(`/api/v1/workspaces/${ws}/invitations`)
    .send({ email: user.email, role })
    .expect(201);
  const token = t.mailer.lastToken(user.email, 'invited you');
  await user.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
}

async function project(owner: U, ws: string, key: string, name: string, members: U[]) {
  const id = (
    await owner.browser.post(`/api/v1/workspaces/${ws}/projects`).send({ name, key }).expect(201)
  ).body.data.project.id as string;
  for (const m of members) {
    await owner.browser.post(`/api/v1/projects/${id}/members`).send({ userId: m.id }).expect(201);
  }
  return id;
}

const task = async (u: U, projectId: string, body: Record<string, unknown>) =>
  (await u.browser.post(`/api/v1/projects/${projectId}/tasks`).send(body).expect(201)).body.data
    .task as { id: string; key: string };

const search = async (u: U, ws: string, q: string) => {
  const res = await u.browser.get(`/api/v1/workspaces/${ws}/search?q=${encodeURIComponent(q)}`);
  return {
    status: res.status,
    tasks: (res.body.data?.tasks ?? []).map((x: { key: string }) => x.key) as string[],
    projects: (res.body.data?.projects ?? []).map((x: { key: string }) => x.key) as string[],
    body: res.body.data,
  };
};

async function setup() {
  const [owner, dev, admin, outsider] = await Promise.all(
    ['owner', 'dev', 'admin', 'outsider'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id as string;
  await join(owner!, ws, dev!);
  await join(owner!, ws, admin!, 'ADMIN');
  const web = await project(owner!, ws, 'WEB', 'Website', [dev!]);
  const ops = await project(owner!, ws, 'OPS', 'Operations', []);
  return { owner: owner!, dev: dev!, admin: admin!, outsider: outsider!, ws, web, ops };
}

it('finds only what the caller can open, and nothing for outsiders (0017)', async () => {
  const { owner, dev, admin, outsider, ws, web, ops } = await setup();
  await task(dev, web, { title: 'Fix login redirect' });
  await task(owner, ops, { title: 'Rotate login keys' });

  expect((await search(dev, ws, 'login')).tasks).toEqual(['WEB-1']);
  expect((await search(admin, ws, 'login')).tasks.sort()).toEqual(['OPS-1', 'WEB-1']);
  expect((await search(dev, ws, 'OPS')).projects).toEqual([]);
  expect((await search(admin, ws, 'OPS')).projects).toEqual(['OPS']);
  expect((await search(outsider, ws, 'login')).status).toBe(404);

  const empty = await search(dev, ws, '   ');
  expect(empty.body).toEqual({ tasks: [], projects: [], hasMoreTasks: false });
});

it('ranks the exact key first, then title matches, open before Done; skips deleted', async () => {
  const { dev, ws, web } = await setup();
  await task(dev, web, { title: 'Payment page', status: 'DONE' }); // WEB-1
  await task(dev, web, { title: 'Refund flow', description: 'Uses the payment API' }); // WEB-2
  await task(dev, web, { title: 'Payment retries' }); // WEB-3
  const gone = await task(dev, web, { title: 'Payment export' }); // WEB-4
  await dev.browser.delete(`/api/v1/tasks/${gone.id}`).expect(204);
  await task(dev, web, { title: 'Mentions WEB-2 in the title' }); // WEB-5

  // Title matches (open, then Done) before the description-only match; deleted tasks never.
  expect((await search(dev, ws, 'payment')).tasks).toEqual(['WEB-3', 'WEB-1', 'WEB-2']);
  // The exact key first, then text containing it.
  expect((await search(dev, ws, 'web-2')).tasks).toEqual(['WEB-2', 'WEB-5']);
  expect((await search(dev, ws, '#3')).tasks).toEqual(['WEB-3']);
  expect((await search(dev, ws, 'Website')).projects).toEqual(['WEB']);
  // Wildcards are literal.
  expect((await search(dev, ws, '%')).tasks).toEqual([]);
  await task(dev, web, { title: 'Discount 50% off' });
  expect((await search(dev, ws, '50%')).tasks).toEqual(['WEB-6']);
});

it('lists archived projects and their tasks after the others, and caps tasks at 20', async () => {
  const { owner, ws, web, ops } = await setup();
  await task(owner, ops, { title: 'Report bug' });
  await task(owner, web, { title: 'Report page' });
  await owner.browser.delete(`/api/v1/projects/${ops}`).expect(204);

  const res = await search(owner, ws, 'report');
  expect(res.tasks).toEqual(['WEB-1', 'OPS-1']);
  expect(res.body.tasks[1].project.status).toBe('ARCHIVED');

  for (let i = 0; i < 21; i++) await task(owner, web, { title: `Bulk item ${i}` });
  const many = await search(owner, ws, 'bulk');
  expect(many.tasks).toHaveLength(20);
  expect(many.body.hasMoreTasks).toBe(true);
});

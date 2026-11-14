import { activityLogs } from '@devtrack/database';
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

it('filters project activity by category on the server, with paging', async () => {
  const [owner, dev, outsider] = await Promise.all(
    ['owner', 'dev', 'outsider'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id as string;
  await owner!.browser
    .post(`/api/v1/workspaces/${ws}/invitations`)
    .send({ email: dev!.email, role: 'MEMBER' })
    .expect(201);
  await dev!.browser
    .post('/api/v1/invitations/accept')
    .send({ token: t.mailer.lastToken(dev!.email, 'invited you') })
    .expect(200);
  const project = (
    await owner!.browser
      .post(`/api/v1/workspaces/${ws}/projects`)
      .send({ name: 'Dev', key: 'DEV' })
      .expect(201)
  ).body.data.project.id as string;
  await owner!.browser
    .post(`/api/v1/projects/${project}/members`)
    .send({ userId: dev!.id })
    .expect(201);
  const task = (
    await dev!.browser.post(`/api/v1/projects/${project}/tasks`).send({ title: 'A' }).expect(201)
  ).body.data.task.id as string;
  await dev!.browser.post(`/api/v1/projects/${project}/tasks`).send({ title: 'B' }).expect(201);
  await dev!.browser.post(`/api/v1/tasks/${task}/comments`).send({ body: 'Hi' }).expect(201);
  // GitHub events arrive by webhook; seed them directly to test only the filter.
  for (const [entityType, action] of [
    ['pull_request', 'opened'],
    ['repository', 'pushed'],
    ['project', 'repository_connected'],
  ]) {
    await t.db.insert(activityLogs).values({
      workspaceId: ws,
      projectId: project,
      entityType: entityType!,
      entityId: project,
      action: action!,
      metadata: {},
    });
  }

  const actions = async (query: string) => {
    const res = await dev!.browser.get(`/api/v1/projects/${project}/activity?${query}`);
    expect(res.status).toBe(200);
    return (res.body.data as { action: string }[]).map((e) => e.action).sort();
  };

  expect(await actions('category=tasks')).toEqual(['task.created', 'task.created']);
  expect(await actions('category=comments')).toEqual(['comment.created']);
  expect(await actions('category=repository')).toEqual([
    'project.repository_connected',
    'pull_request.opened',
    'repository.pushed',
  ]);
  expect(await actions('category=members')).toEqual(['project.member_added']);
  const all = await actions('');
  expect(all).toContain('project.created');
  expect(all).toHaveLength(8);

  // Paging stays inside the category.
  const page1 = await dev!.browser.get(
    `/api/v1/projects/${project}/activity?category=repository&limit=2`,
  );
  expect(page1.body.data).toHaveLength(2);
  const page2 = await dev!.browser.get(
    `/api/v1/projects/${project}/activity?category=repository&limit=2&cursor=${page1.body.meta.nextCursor}`,
  );
  expect(page2.body.data).toHaveLength(1);
  expect(page2.body.meta.hasMore).toBe(false);

  expect(
    (await dev!.browser.get(`/api/v1/projects/${project}/activity?category=nope`)).status,
  ).toBe(400);
  expect((await outsider!.browser.get(`/api/v1/projects/${project}/activity`)).status).toBe(404);
});

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
interface TaskDto {
  id: string;
  key: string;
  status: string;
  priority: string;
  assignees: { id: string }[];
  labels: { id: string }[];
}

async function join(owner: U, ws: string, user: U) {
  await owner.browser
    .post(`/api/v1/workspaces/${ws}/invitations`)
    .send({ email: user.email, role: 'MEMBER' })
    .expect(201);
  const token = t.mailer.lastToken(user.email, 'invited you');
  await user.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
}

async function setup() {
  const [owner, dev, bystander, outsider] = await Promise.all(
    ['owner', 'dev', 'bystander', 'outsider'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id as string;
  await join(owner!, ws, dev!);
  await join(owner!, ws, bystander!);
  const newProject = async (key: string) =>
    (
      await owner!.browser
        .post(`/api/v1/workspaces/${ws}/projects`)
        .send({ name: key, key })
        .expect(201)
    ).body.data.project.id as string;
  const project = await newProject('DEV');
  const other = await newProject('OPS');
  await owner!.browser
    .post(`/api/v1/projects/${project}/members`)
    .send({ userId: dev!.id })
    .expect(201);
  const task = async (p: string) =>
    (await owner!.browser.post(`/api/v1/projects/${p}/tasks`).send({ title: 'T' }).expect(201)).body
      .data.task.id as string;
  const ids = [await task(project), await task(project), await task(project)];
  const otherTask = await task(other);
  const label = (
    await owner!.browser
      .post(`/api/v1/workspaces/${ws}/labels`)
      .send({ name: 'Backend', color: '#2f6fdb' })
      .expect(201)
  ).body.data.label.id as string;
  const elsewhere = (await outsider!.browser.post('/api/v1/workspaces').send({ name: 'Else' })).body
    .data.workspace.id as string;
  const foreignLabel = (
    await outsider!.browser
      .post(`/api/v1/workspaces/${elsewhere}/labels`)
      .send({ name: 'Foreign', color: '#2f6fdb' })
      .expect(201)
  ).body.data.label.id as string;
  return {
    owner: owner!,
    dev: dev!,
    bystander: bystander!,
    outsider: outsider!,
    project,
    ids,
    otherTask,
    label,
    foreignLabel,
  };
}

const bulk = (u: U, project: string, body: Record<string, unknown>) =>
  u.browser.patch(`/api/v1/projects/${project}/tasks/bulk`).send(body);

const statuses = async (u: U, project: string) =>
  ((await u.browser.get(`/api/v1/projects/${project}/tasks`)).body.data as TaskDto[]).map(
    (x) => `${x.key}:${x.status}:${x.priority}`,
  );

it('applies one change to many tasks, with the same history as single edits', async () => {
  const { dev, owner, project, ids, label } = await setup();
  // One task already has the label and the assignee: no duplicate rows or activity.
  await owner.browser.post(`/api/v1/tasks/${ids[0]}/labels`).send({ labelId: label }).expect(200);
  await owner.browser
    .post(`/api/v1/tasks/${ids[0]}/assignees`)
    .send({ userIds: [dev.id] })
    .expect(200);

  const res = await bulk(dev, project, {
    taskIds: ids,
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    addAssigneeIds: [dev.id],
    addLabelIds: [label],
  });
  expect(res.status).toBe(200);
  const tasks = res.body.data.tasks as TaskDto[];
  expect(tasks.map((x) => x.id)).toEqual(ids);
  for (const x of tasks) {
    expect(x).toMatchObject({ status: 'IN_PROGRESS', priority: 'HIGH' });
    expect(x.assignees.map((a) => a.id)).toEqual([dev.id]);
    expect(x.labels.map((l) => l.id)).toEqual([label]);
  }

  const actions = async (taskId: string) =>
    (
      (await dev.browser.get(`/api/v1/projects/${project}/activity?taskId=${taskId}&limit=50`)).body
        .data as { action: string }[]
    )
      .map((e) => e.action)
      .sort();
  expect(await actions(ids[0]!)).toEqual([
    'task.assigned',
    'task.created',
    'task.labeled',
    'task.updated',
  ]);
  expect(await actions(ids[1]!)).toEqual([
    'task.assigned',
    'task.created',
    'task.labeled',
    'task.updated',
  ]);

  // Re-applying the same change records nothing new.
  await bulk(dev, project, { taskIds: ids, status: 'IN_PROGRESS', addLabelIds: [label] }).expect(
    200,
  );
  expect(await actions(ids[2]!)).toHaveLength(4);
});

it('changes nothing when any part of the request is invalid', async () => {
  const { dev, bystander, outsider, owner, project, ids, otherTask, foreignLabel } = await setup();
  const before = await statuses(dev, project);

  const cases: [Record<string, unknown>, number][] = [
    [{ taskIds: [...ids, otherTask], status: 'DONE' }, 404],
    [{ taskIds: ids, status: 'DONE', addAssigneeIds: [bystander.id] }, 400],
    [{ taskIds: ids, status: 'DONE', addLabelIds: [foreignLabel] }, 404],
    [{ taskIds: ids }, 400],
    [{ taskIds: [], status: 'DONE' }, 400],
    [{ taskIds: Array.from({ length: 101 }, () => crypto.randomUUID()), status: 'DONE' }, 400],
    [{ taskIds: ids, status: 'NOPE' }, 400],
  ];
  for (const [body, status] of cases) {
    expect((await bulk(dev, project, body)).status).toBe(status);
  }
  expect(await statuses(dev, project)).toEqual(before);

  // No access to the project: the same 404 as for a missing project.
  expect((await bulk(bystander, project, { taskIds: ids, status: 'DONE' })).status).toBe(404);
  expect((await bulk(outsider, project, { taskIds: ids, status: 'DONE' })).status).toBe(404);

  // Archived projects are read-only.
  await owner.browser.delete(`/api/v1/projects/${project}`).expect(204);
  expect((await bulk(owner, project, { taskIds: ids, status: 'DONE' })).status).toBe(409);
});

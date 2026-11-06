import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, type TestApp } from './utils/test-app';

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

describe('labels', () => {
  it('any member creates; names are unique per workspace case-insensitively; colors normalized', async () => {
    const { dev, bystander, outsider, ws } = await projectFixture(t);
    const created = await dev.browser
      .post(`/api/v1/workspaces/${ws}/labels`)
      .send({ name: 'Bug', color: '#DC2626' });
    expect(created.status).toBe(201);
    expect(created.body.data.label).toMatchObject({
      name: 'Bug',
      color: '#dc2626',
      workspaceId: ws,
    });

    const dup = await bystander.browser
      .post(`/api/v1/workspaces/${ws}/labels`)
      .send({ name: 'bug', color: '#000000' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('LABEL_NAME_TAKEN');

    expect((await outsider.browser.get(`/api/v1/workspaces/${ws}/labels`)).status).toBe(404);
    const list = await bystander.browser.get(`/api/v1/workspaces/${ws}/labels`).expect(200);
    expect(list.body.data.map((l: { name: string }) => l.name)).toEqual(['Bug']);
  });

  it('only admins rename or delete; deleting detaches the label from tasks', async () => {
    const { admin, dev, outsider, ws, project } = await projectFixture(t);
    const label = (
      await dev.browser
        .post(`/api/v1/workspaces/${ws}/labels`)
        .send({ name: 'Bug', color: '#dc2626' })
    ).body.data.label.id;
    const task = (await dev.browser.post(`/api/v1/projects/${project}/tasks`).send({ title: 'T' }))
      .body.data.task.id;
    await dev.browser.post(`/api/v1/tasks/${task}/labels`).send({ labelId: label }).expect(200);

    expect(
      (await dev.browser.patch(`/api/v1/labels/${label}`).send({ name: 'Defect' })).status,
    ).toBe(403);
    expect((await outsider.browser.delete(`/api/v1/labels/${label}`)).status).toBe(404);
    const renamed = await admin.browser
      .patch(`/api/v1/labels/${label}`)
      .send({ name: 'Defect', color: '#ea580c' });
    expect(renamed.body.data.label).toMatchObject({ name: 'Defect', color: '#ea580c' });

    await admin.browser.delete(`/api/v1/labels/${label}`).expect(204);
    expect((await dev.browser.get(`/api/v1/tasks/${task}`)).body.data.task.labels).toEqual([]);
  });

  it('attaches, filters and detaches labels on tasks; rejects labels from another workspace', async () => {
    const { dev, outsider, ws, project } = await projectFixture(t);
    const bug = (
      await dev.browser
        .post(`/api/v1/workspaces/${ws}/labels`)
        .send({ name: 'Bug', color: '#dc2626' })
    ).body.data.label.id;
    const t1 = (await dev.browser.post(`/api/v1/projects/${project}/tasks`).send({ title: 'One' }))
      .body.data.task.id;
    await dev.browser.post(`/api/v1/projects/${project}/tasks`).send({ title: 'Two' }).expect(201);

    const attached = await dev.browser.post(`/api/v1/tasks/${t1}/labels`).send({ labelId: bug });
    expect(attached.body.data.task.labels).toEqual([{ id: bug, name: 'Bug', color: '#dc2626' }]);
    await dev.browser.post(`/api/v1/tasks/${t1}/labels`).send({ labelId: bug }).expect(200); // idempotent

    const filtered = await dev.browser.get(`/api/v1/projects/${project}/tasks?labelId=${bug}`);
    expect(filtered.body.data.map((x: { key: string }) => x.key)).toEqual(['DEV-1']);

    // A label from a different workspace cannot be attached (cross-workspace link).
    const otherWs = (await outsider.browser.post('/api/v1/workspaces').send({ name: 'Other' })).body
      .data.workspace.id;
    const foreign = (
      await outsider.browser
        .post(`/api/v1/workspaces/${otherWs}/labels`)
        .send({ name: 'X', color: '#111111' })
    ).body.data.label.id;
    expect(
      (await dev.browser.post(`/api/v1/tasks/${t1}/labels`).send({ labelId: foreign })).status,
    ).toBe(404);

    const detached = await dev.browser.delete(`/api/v1/tasks/${t1}/labels/${bug}`);
    expect(detached.body.data.task.labels).toEqual([]);
    expect((await dev.browser.delete(`/api/v1/tasks/${t1}/labels/${bug}`)).status).toBe(404);
  });
});

describe('milestones', () => {
  it('admins manage; project members read; others get 404', async () => {
    const { admin, dev, bystander, project } = await projectFixture(t);
    expect(
      (await dev.browser.post(`/api/v1/projects/${project}/milestones`).send({ name: 'Beta' }))
        .status,
    ).toBe(403);

    const beta = await admin.browser
      .post(`/api/v1/projects/${project}/milestones`)
      .send({ name: 'Beta', dueDate: '2026-12-01', description: 'First external users' });
    expect(beta.status).toBe(201);
    expect(beta.body.data.milestone).toMatchObject({
      name: 'Beta',
      status: 'OPEN',
      dueDate: '2026-12-01',
    });
    await admin.browser
      .post(`/api/v1/projects/${project}/milestones`)
      .send({ name: 'GA', dueDate: '2027-02-01' });
    await admin.browser.post(`/api/v1/projects/${project}/milestones`).send({ name: 'Someday' });

    const list = await dev.browser.get(`/api/v1/projects/${project}/milestones`).expect(200);
    expect(list.body.data.map((m: { name: string }) => m.name)).toEqual(['Beta', 'GA', 'Someday']);
    expect((await bystander.browser.get(`/api/v1/projects/${project}/milestones`)).status).toBe(
      404,
    );

    const id = beta.body.data.milestone.id;
    expect(
      (await dev.browser.patch(`/api/v1/milestones/${id}`).send({ status: 'COMPLETED' })).status,
    ).toBe(403);
    expect(
      (await bystander.browser.patch(`/api/v1/milestones/${id}`).send({ status: 'COMPLETED' }))
        .status,
    ).toBe(404);
    const done = await admin.browser
      .patch(`/api/v1/milestones/${id}`)
      .send({ status: 'COMPLETED', dueDate: null });
    expect(done.body.data.milestone).toMatchObject({ status: 'COMPLETED', dueDate: null });

    // Completed milestones sort after open ones.
    const after = await dev.browser.get(`/api/v1/projects/${project}/milestones`);
    expect(after.body.data.map((m: { name: string }) => m.name)).toEqual(['GA', 'Someday', 'Beta']);

    await admin.browser.delete(`/api/v1/milestones/${id}`).expect(204);
    expect((await admin.browser.delete(`/api/v1/milestones/${id}`)).status).toBe(404);
  });

  it('is read-only in archived projects', async () => {
    const { admin, project } = await projectFixture(t);
    const id = (
      await admin.browser.post(`/api/v1/projects/${project}/milestones`).send({ name: 'Beta' })
    ).body.data.milestone.id;
    await admin.browser.delete(`/api/v1/projects/${project}`).expect(204);
    expect(
      (await admin.browser.patch(`/api/v1/milestones/${id}`).send({ name: 'x' })).body.error.code,
    ).toBe('PROJECT_ARCHIVED');
    await admin.browser.get(`/api/v1/projects/${project}/milestones`).expect(200);
  });
});

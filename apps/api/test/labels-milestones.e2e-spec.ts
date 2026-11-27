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
      status: 'PLANNED',
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
      (await dev.browser.patch(`/api/v1/milestones/${id}`).send({ status: 'DELIVERED' })).status,
    ).toBe(403);
    expect(
      (await bystander.browser.patch(`/api/v1/milestones/${id}`).send({ status: 'DELIVERED' }))
        .status,
    ).toBe(404);
    const done = await admin.browser
      .patch(`/api/v1/milestones/${id}`)
      .send({ status: 'DELIVERED', dueDate: null });
    expect(done.body.data.milestone).toMatchObject({ status: 'DELIVERED', dueDate: null });

    // Delivered milestones sort last.
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

describe('milestone stages (0025 §2)', () => {
  type F = Awaited<ReturnType<typeof projectFixture>>;
  const stage = (f: F, id: string, status: string) =>
    f.admin.browser.patch(`/api/v1/milestones/${id}`).send({ status }).expect(200);

  it('starts Planned, sets startedAt once and deliveredAt while delivered, and records each move', async () => {
    const f = await projectFixture(t);
    const created = await f.admin.browser
      .post(`/api/v1/projects/${f.project}/milestones`)
      .send({ name: 'v1.2' })
      .expect(201);
    const id = created.body.data.milestone.id as string;
    expect(created.body.data.milestone).toMatchObject({
      status: 'PLANNED',
      startedAt: null,
      deliveredAt: null,
    });

    const active = (await stage(f, id, 'ACTIVE')).body.data.milestone;
    expect(active.startedAt).not.toBeNull();
    const review = (await stage(f, id, 'CLIENT_REVIEW')).body.data.milestone;
    const delivered = (await stage(f, id, 'DELIVERED')).body.data.milestone;
    expect(delivered.deliveredAt).not.toBeNull();
    const back = (await stage(f, id, 'ACTIVE')).body.data.milestone;
    // Scope was agreed the first time it became Active; going back doesn't move that.
    expect([review.startedAt, delivered.startedAt, back.startedAt]).toEqual([
      active.startedAt,
      active.startedAt,
      active.startedAt,
    ]);
    expect(back.deliveredAt).toBeNull();

    const feed = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity?limit=50`);
    const moves = (
      feed.body.data as { action: string; metadata: { stage?: { to: string } } }[]
    ).filter((e) => e.action.startsWith('milestone.'));
    expect(moves.map((e) => [e.action, e.metadata.stage?.to ?? null]).reverse()).toEqual([
      ['milestone.stage_changed', 'ACTIVE'],
      ['milestone.stage_changed', 'CLIENT_REVIEW'],
      ['milestone.completed', null],
      ['milestone.stage_changed', 'ACTIVE'],
    ]);

    const told = await f.dev.browser.get('/api/v1/notifications').expect(200);
    expect(
      (told.body.data as { type: string; title: string }[])
        .filter((n) => n.type === 'MILESTONE_COMPLETED')
        .map((n) => n.title),
    ).toEqual(['Milestone "v1.2" delivered in DEV']);
  });

  it('takes no new tasks once delivered, but tasks already in it stay', async () => {
    const f = await projectFixture(t);
    const id = (
      await f.admin.browser
        .post(`/api/v1/projects/${f.project}/milestones`)
        .send({ name: 'v1.0', status: 'ACTIVE' })
        .expect(201)
    ).body.data.milestone.id as string;
    const inside = (
      await f.dev.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'Shipped work', milestoneId: id })
        .expect(201)
    ).body.data.task.id as string;
    const outside = (
      await f.dev.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'Later work' })
        .expect(201)
    ).body.data.task.id as string;
    await stage(f, id, 'DELIVERED');

    const create = await f.dev.browser
      .post(`/api/v1/projects/${f.project}/tasks`)
      .send({ title: 'Too late', milestoneId: id });
    expect(create.status).toBe(400);
    expect(
      (await f.dev.browser.patch(`/api/v1/tasks/${outside}`).send({ milestoneId: id })).status,
    ).toBe(400);
    // Saving a task that's already in it (the task page sends its milestone) still works.
    await f.dev.browser
      .patch(`/api/v1/tasks/${inside}`)
      .send({ title: 'Shipped work, renamed', milestoneId: id })
      .expect(200);
  });
});

describe('added after start (0025 §3)', () => {
  it('flags tasks that join a milestone once it is Active, counts them, and filters them', async () => {
    const f = await projectFixture(t);
    const milestone = async (name: string) =>
      (
        await f.admin.browser
          .post(`/api/v1/projects/${f.project}/milestones`)
          .send({ name })
          .expect(201)
      ).body.data.milestone.id as string;
    const create = async (title: string, milestoneId?: string) =>
      (
        await f.dev.browser
          .post(`/api/v1/projects/${f.project}/tasks`)
          .send({ title, ...(milestoneId ? { milestoneId } : {}) })
          .expect(201)
      ).body.data.task as { id: string; addedAfterStart: boolean };
    const flagged = async (id: string) =>
      (await f.dev.browser.get(`/api/v1/tasks/${id}`).expect(200)).body.data.task
        .addedAfterStart as boolean;

    const v12 = await milestone('v1.2');
    const later = await milestone('v1.3');
    const agreed = await create('Agreed scope', v12);
    const loose = await create('Loose task');
    await f.admin.browser.patch(`/api/v1/milestones/${v12}`).send({ status: 'ACTIVE' }).expect(200);

    const extra = await create('Extra request', v12);
    expect(extra.addedAfterStart).toBe(true);
    await f.dev.browser.patch(`/api/v1/tasks/${loose.id}`).send({ milestoneId: v12 }).expect(200);
    expect(await flagged(loose.id)).toBe(true);
    expect(await flagged(agreed.id)).toBe(false);

    const counts = (
      await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`)
    ).body.data.find((m: { id: string }) => m.id === v12).taskCounts;
    expect(counts).toEqual({ total: 3, done: 0, addedAfterStart: 2 });

    const listed = await f.dev.browser
      .get(`/api/v1/projects/${f.project}/tasks?milestoneId=added`)
      .expect(200);
    expect(listed.body.data.map((t: { title: string }) => t.title).sort()).toEqual([
      'Extra request',
      'Loose task',
    ]);

    // Leaving the milestone, or moving to one that hasn't started, clears the flag.
    await f.dev.browser.patch(`/api/v1/tasks/${loose.id}`).send({ milestoneId: null }).expect(200);
    expect(await flagged(loose.id)).toBe(false);
    await f.dev.browser.patch(`/api/v1/tasks/${extra.id}`).send({ milestoneId: later }).expect(200);
    expect(await flagged(extra.id)).toBe(false);
  });
});

describe('milestone readiness notification (0025 §4)', () => {
  it('notifies responsible people once per readiness transition across task and criterion changes', async () => {
    const f = await projectFixture(t);
    const readyNotices = async (who: typeof f.admin) =>
      (
        (await who.browser.get('/api/v1/notifications').expect(200)).body.data as {
          type: string;
          title: string;
          link: string | null;
        }[]
      ).filter((n) => n.type === 'MILESTONE_READY');

    const mId = (
      await f.admin.browser
        .post(`/api/v1/projects/${f.project}/milestones`)
        .send({ name: 'v1.4', status: 'ACTIVE' })
        .expect(201)
    ).body.data.milestone.id as string;

    const cId = (
      await f.admin.browser
        .post(`/api/v1/milestones/${mId}/criteria`)
        .send({ text: 'QA signed off' })
        .expect(201)
    ).body.data.milestone.criteria[0].id as string;

    const t1 = (
      await f.dev.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'Build feature', milestoneId: mId })
        .expect(201)
    ).body.data.task.id as string;
    const t2 = (
      await f.dev.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'Write docs', milestoneId: mId })
        .expect(201)
    ).body.data.task.id as string;

    // Tasks done, but criterion is still unticked -> no notification yet.
    await f.dev.browser
      .patch(`/api/v1/projects/${f.project}/tasks/bulk`)
      .send({ taskIds: [t1, t2], status: 'DONE' })
      .expect(200);
    expect(await readyNotices(f.admin)).toHaveLength(0);

    // Ticking the last criterion makes it ready; dev isn't a lead/admin, so admin (responsible) is notified.
    await f.admin.browser
      .patch(`/api/v1/milestone-criteria/${cId}`)
      .send({ done: true })
      .expect(200);
    // Re-save when f.admin ticked it: EventRecorder.notify skips the actor, so let's verify when dev triggers it!
    // Wait: admin ticked the criterion, so admin is the actor -> skipped by EventRecorder.notify.
    expect(await readyNotices(f.admin)).toHaveLength(0);

    // Reopen t1 (makes it un-ready), then dev marks t1 Done -> admin gets notified!
    await f.dev.browser.patch(`/api/v1/tasks/${t1}`).send({ status: 'IN_PROGRESS' }).expect(200);
    await f.dev.browser.patch(`/api/v1/tasks/${t1}`).send({ status: 'DONE' }).expect(200);
    expect(await readyNotices(f.admin)).toEqual([
      expect.objectContaining({
        type: 'MILESTONE_READY',
        title: 'Milestone "v1.4" is ready for Client review in DEV',
        link: `/projects/${f.project}/milestones`,
      }),
    ]);

    // Adding an extra Done task while already ready does not send a duplicate notification.
    await f.dev.browser
      .post(`/api/v1/projects/${f.project}/tasks`)
      .send({ title: 'Bonus fix', milestoneId: mId, status: 'DONE' })
      .expect(201);
    expect(await readyNotices(f.admin)).toHaveLength(1);

    // Adding an open task makes it un-ready; removing that task makes it ready again -> notifies a second time.
    const extra = (
      await f.dev.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'Follow-up', milestoneId: mId })
        .expect(201)
    ).body.data.task.id as string;
    await f.dev.browser.patch(`/api/v1/tasks/${extra}`).send({ milestoneId: null }).expect(200);
    expect(await readyNotices(f.admin)).toHaveLength(2);
  });
});

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

type Fixture = Awaited<ReturnType<typeof projectFixture>>;

async function milestone(f: Fixture, name: string, project = f.project): Promise<string> {
  const res = await f.admin.browser.post(`/api/v1/projects/${project}/milestones`).send({ name });
  expect(res.status).toBe(201);
  return res.body.data.milestone.id;
}

async function task(f: Fixture, body: Record<string, unknown>) {
  return f.dev.browser.post(`/api/v1/projects/${f.project}/tasks`).send({ title: 'T', ...body });
}

describe('tasks in milestones', () => {
  it('assigns on create and update, counts real progress, and filters', async () => {
    const f = await projectFixture(t);
    const beta = await milestone(f, 'Beta');
    const ga = await milestone(f, 'GA');

    const created = await task(f, { title: 'Login page', milestoneId: beta });
    expect(created.status).toBe(201);
    expect(created.body.data.task.milestoneId).toBe(beta);
    const a = created.body.data.task.id;
    const b = (await task(f, { title: 'Signup', milestoneId: beta, status: 'DONE' })).body.data.task
      .id;
    const loose = (await task(f, { title: 'Unplanned' })).body.data.task;
    expect(loose.milestoneId).toBeNull();

    let list = await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`).expect(200);
    const counts = (name: string) =>
      list.body.data.find((m: { name: string }) => m.name === name).taskCounts;
    expect(counts('Beta')).toEqual({ total: 2, done: 1 });
    expect(counts('GA')).toEqual({ total: 0, done: 0 });

    // Moving a task records the milestone names in activity and updates counts.
    const moved = await f.dev.browser.patch(`/api/v1/tasks/${a}`).send({ milestoneId: ga });
    expect(moved.status).toBe(200);
    expect(moved.body.data.task.milestoneId).toBe(ga);
    const activity = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity`).expect(200);
    const update = activity.body.data.find((e: { action: string }) => e.action === 'task.updated');
    expect(update.metadata.changes).toEqual({ milestone: { from: 'Beta', to: 'GA' } });

    // Deleted tasks don't count.
    await f.dev.browser.delete(`/api/v1/tasks/${b}`).expect(204);
    list = await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`).expect(200);
    expect(counts('Beta')).toEqual({ total: 0, done: 0 });
    expect(counts('GA')).toEqual({ total: 1, done: 0 });

    const inGa = await f.dev.browser.get(`/api/v1/projects/${f.project}/tasks?milestoneId=${ga}`);
    expect(inGa.body.data.map((x: { id: string }) => x.id)).toEqual([a]);
    const none = await f.dev.browser.get(`/api/v1/projects/${f.project}/tasks?milestoneId=none`);
    expect(none.body.data.map((x: { id: string }) => x.id)).toEqual([loose.id]);

    // `null` removes the task from its milestone.
    const cleared = await f.dev.browser.patch(`/api/v1/tasks/${a}`).send({ milestoneId: null });
    expect(cleared.body.data.task.milestoneId).toBeNull();
  });

  it('rejects milestones from another project, and deleting a milestone keeps its tasks', async () => {
    const f = await projectFixture(t);
    const other = (
      await f.owner.browser
        .post(`/api/v1/workspaces/${f.ws}/projects`)
        .send({ name: 'Other', key: 'OTH' })
    ).body.data.project.id;
    const foreign = await milestone(f, 'Elsewhere', other);
    const bad = await task(f, { milestoneId: foreign });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('milestoneId');

    const beta = await milestone(f, 'Beta');
    const id = (await task(f, { milestoneId: beta })).body.data.task.id;
    expect(
      (await f.dev.browser.patch(`/api/v1/tasks/${id}`).send({ milestoneId: foreign })).status,
    ).toBe(400);

    await f.admin.browser.delete(`/api/v1/milestones/${beta}`).expect(204);
    const after = await f.dev.browser.get(`/api/v1/tasks/${id}`).expect(200);
    expect(after.body.data.task.milestoneId).toBeNull();
  });
});

describe('acceptance criteria', () => {
  it('admins add, check, edit and delete criteria in order; members only read', async () => {
    const f = await projectFixture(t);
    const beta = await milestone(f, 'Beta');

    expect(
      (await f.dev.browser.post(`/api/v1/milestones/${beta}/criteria`).send({ text: 'x' })).status,
    ).toBe(403);
    expect(
      (await f.bystander.browser.post(`/api/v1/milestones/${beta}/criteria`).send({ text: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await f.admin.browser.post(`/api/v1/milestones/${beta}/criteria`).send({ text: '  ' }))
        .status,
    ).toBe(400);

    await f.admin.browser
      .post(`/api/v1/milestones/${beta}/criteria`)
      .send({ text: 'Users can sign in with email' })
      .expect(201);
    const second = await f.admin.browser
      .post(`/api/v1/milestones/${beta}/criteria`)
      .send({ text: 'Works on mobile' })
      .expect(201);
    const criteria = second.body.data.milestone.criteria;
    expect(criteria.map((c: { text: string }) => c.text)).toEqual([
      'Users can sign in with email',
      'Works on mobile',
    ]);
    expect(criteria.every((c: { done: boolean }) => !c.done)).toBe(true);
    const first = criteria[0].id;

    expect(
      (await f.dev.browser.patch(`/api/v1/milestone-criteria/${first}`).send({ done: true }))
        .status,
    ).toBe(403);
    const checked = await f.admin.browser
      .patch(`/api/v1/milestone-criteria/${first}`)
      .send({ done: true });
    expect(checked.status).toBe(200);
    expect(checked.body.data.milestone.criteria[0]).toMatchObject({
      done: true,
      doneBy: { id: f.admin.id },
    });
    expect(checked.body.data.milestone.criteria[0].doneAt).toEqual(expect.any(String));

    const read = await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`).expect(200);
    expect(read.body.data[0].criteria.map((c: { done: boolean }) => c.done)).toEqual([true, false]);

    const edited = await f.admin.browser
      .patch(`/api/v1/milestone-criteria/${first}`)
      .send({ text: 'Users can sign in', done: false });
    expect(edited.body.data.milestone.criteria[0]).toMatchObject({
      text: 'Users can sign in',
      done: false,
      doneAt: null,
      doneBy: null,
    });

    const removed = await f.admin.browser.delete(`/api/v1/milestone-criteria/${first}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.milestone.criteria.map((c: { text: string }) => c.text)).toEqual([
      'Works on mobile',
    ]);
    expect((await f.admin.browser.delete(`/api/v1/milestone-criteria/${first}`)).status).toBe(404);

    // Deleting the milestone removes its criteria.
    await f.admin.browser.delete(`/api/v1/milestones/${beta}`).expect(204);
    const orphan = criteria[1].id;
    expect(
      (await f.admin.browser.patch(`/api/v1/milestone-criteria/${orphan}`).send({ done: true }))
        .status,
    ).toBe(404);
  });

  it('is read-only in archived projects', async () => {
    const f = await projectFixture(t);
    const beta = await milestone(f, 'Beta');
    await f.admin.browser.delete(`/api/v1/projects/${f.project}`).expect(204);
    const res = await f.admin.browser
      .post(`/api/v1/milestones/${beta}/criteria`)
      .send({ text: 'x' });
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

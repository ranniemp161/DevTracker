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

describe('project task counts', () => {
  it('counts live tasks and done tasks on the project and in the workspace list', async () => {
    const f = await projectFixture(t);
    const create = (body: Record<string, unknown>) =>
      f.dev.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'T', ...body })
        .expect(201);

    const counts = async () => {
      const one = await f.dev.browser.get(`/api/v1/projects/${f.project}`).expect(200);
      const list = await f.dev.browser.get(`/api/v1/workspaces/${f.ws}/projects`).expect(200);
      const listed = list.body.data.find((p: { id: string }) => p.id === f.project);
      expect(listed.taskCounts).toEqual(one.body.data.project.taskCounts);
      return one.body.data.project.taskCounts;
    };

    expect(await counts()).toEqual({ total: 0, done: 0 });

    await create({ title: 'Open' });
    await create({ title: 'Shipped', status: 'DONE' });
    const doomed = (await create({ title: 'Also shipped', status: 'DONE' })).body.data.task.id;
    expect(await counts()).toEqual({ total: 3, done: 2 });

    // Deleted tasks don't count.
    await f.dev.browser.delete(`/api/v1/tasks/${doomed}`).expect(204);
    expect(await counts()).toEqual({ total: 2, done: 1 });
  });
});

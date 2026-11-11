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

describe('time in status', () => {
  it('follows the status history and is hidden from people without project access', async () => {
    const f = await projectFixture(t);
    const created = await f.dev.browser
      .post(`/api/v1/projects/${f.project}/tasks`)
      .send({ title: 'Login page', status: 'BACKLOG' });
    const id = created.body.data.task.id;
    const time = async () =>
      (await f.dev.browser.get(`/api/v1/tasks/${id}/time-in-status`).expect(200)).body.data.time;
    const statuses = (r: { totals: { status: string }[] }) => r.totals.map((x) => x.status);

    let result = await time();
    expect(statuses(result)).toEqual(['BACKLOG']);
    expect(result.cycleSeconds).toBeNull();
    expect(result.currentSince).toBe(created.body.data.task.createdAt);

    // A title edit is not a status change.
    await f.dev.browser.patch(`/api/v1/tasks/${id}`).send({ title: 'Sign-in page' }).expect(200);
    for (const status of ['IN_PROGRESS', 'IN_REVIEW', 'IN_PROGRESS', 'DONE']) {
      await f.dev.browser.patch(`/api/v1/tasks/${id}/status`).send({ status }).expect(200);
    }

    result = await time();
    expect(statuses(result)).toEqual(['BACKLOG', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);
    expect(result.cycleSeconds).toEqual(expect.any(Number));
    expect(new Date(result.currentSince).getTime()).toBeGreaterThan(
      new Date(created.body.data.task.createdAt).getTime(),
    );
    for (const total of result.totals) expect(total.seconds).toBeGreaterThanOrEqual(0);

    await f.bystander.browser.get(`/api/v1/tasks/${id}/time-in-status`).expect(404);
    await f.outsider.browser.get(`/api/v1/tasks/${id}/time-in-status`).expect(404);
  });
});

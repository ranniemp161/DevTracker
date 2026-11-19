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

async function newTask(f: Fixture, body: Record<string, unknown> = {}) {
  const res = await f.dev.browser
    .post(`/api/v1/projects/${f.project}/tasks`)
    .send({ title: 'Login page', ...body });
  expect(res.status).toBe(201);
  return res.body.data.task;
}

describe('estimates', () => {
  it('sets, changes and clears the estimate, and records it in activity', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f, { estimateMinutes: 120 });
    expect(task.estimateMinutes).toBe(120);
    expect(task.loggedMinutes).toBe(0);

    const changed = await f.dev.browser
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ estimateMinutes: 90 });
    expect(changed.body.data.task.estimateMinutes).toBe(90);
    const activity = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity`).expect(200);
    const update = activity.body.data.find((e: { action: string }) => e.action === 'task.updated');
    expect(update.metadata.changes).toEqual({ estimateMinutes: { from: 120, to: 90 } });

    const cleared = await f.dev.browser
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ estimateMinutes: null });
    expect(cleared.body.data.task.estimateMinutes).toBeNull();

    for (const estimateMinutes of [0, -5, 1.5, 60_001]) {
      await f.dev.browser.patch(`/api/v1/tasks/${task.id}`).send({ estimateMinutes }).expect(400);
    }
  });
});

describe('time entries', () => {
  it('logs, lists, edits and removes time, and keeps the task total in step', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    const base = `/api/v1/tasks/${task.id}/time-entries`;

    const first = await f.dev.browser
      .post(base)
      .send({ minutes: 90, spentOn: '2026-11-10', note: '  Wire up the form  ' });
    expect(first.status).toBe(201);
    expect(first.body.data.entry).toMatchObject({
      taskId: task.id,
      minutes: 90,
      spentOn: '2026-11-10',
      note: 'Wire up the form',
      user: { id: f.dev.id },
    });
    await f.admin.browser.post(base).send({ minutes: 30, spentOn: '2026-11-11' }).expect(201);

    // Most recent work day first.
    const list = await f.dev.browser.get(base).expect(200);
    expect(list.body.data.entries.map((e: { minutes: number }) => e.minutes)).toEqual([30, 90]);
    const total = async () =>
      (await f.dev.browser.get(`/api/v1/tasks/${task.id}`).expect(200)).body.data.task
        .loggedMinutes;
    expect(await total()).toBe(120);

    // Anyone who can edit the task can change someone else's entry.
    const entryId = first.body.data.entry.id;
    const edited = await f.admin.browser
      .patch(`/api/v1/time-entries/${entryId}`)
      .send({ minutes: 60, note: '' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.entry).toMatchObject({
      minutes: 60,
      note: null,
      user: { id: f.dev.id },
    });
    expect(await total()).toBe(90);

    await f.admin.browser.delete(`/api/v1/time-entries/${entryId}`).expect(204);
    expect(await total()).toBe(30);
    await f.dev.browser.delete(`/api/v1/time-entries/${entryId}`).expect(404);

    // Activity records the minutes but never the note text.
    const activity = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity`).expect(200);
    const byAction = (action: string) =>
      activity.body.data.filter((e: { action: string }) => e.action === action);
    expect(byAction('task.time_logged')).toHaveLength(2);
    expect(byAction('task.time_updated')[0].metadata.minutes).toEqual({ from: 90, to: 60 });
    expect(byAction('task.time_removed')[0].metadata.minutes).toBe(60);
    expect(JSON.stringify(activity.body.data)).not.toContain('Wire up the form');
  });

  it('validates input', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    const base = `/api/v1/tasks/${task.id}/time-entries`;
    for (const body of [
      { minutes: 0, spentOn: '2026-11-10' },
      { minutes: 1441, spentOn: '2026-11-10' },
      { minutes: 30, spentOn: '10/11/2026' },
      { minutes: 30 },
      { minutes: 30, spentOn: '2026-11-10', note: 'x'.repeat(501) },
    ]) {
      await f.dev.browser.post(base).send(body).expect(400);
    }
  });

  it('is closed to people without project access and read-only once archived', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    const base = `/api/v1/tasks/${task.id}/time-entries`;
    const entry = (await f.dev.browser.post(base).send({ minutes: 30, spentOn: '2026-11-10' })).body
      .data.entry;

    for (const user of [f.bystander, f.outsider]) {
      await user.browser.get(base).expect(404);
      await user.browser.post(base).send({ minutes: 30, spentOn: '2026-11-10' }).expect(404);
      await user.browser.patch(`/api/v1/time-entries/${entry.id}`).send({ minutes: 5 }).expect(404);
      await user.browser.delete(`/api/v1/time-entries/${entry.id}`).expect(404);
    }

    await f.owner.browser.delete(`/api/v1/projects/${f.project}`).expect(204);
    await f.owner.browser.get(base).expect(200);
    await f.owner.browser.post(base).send({ minutes: 30, spentOn: '2026-11-10' }).expect(409);
    await f.owner.browser.delete(`/api/v1/time-entries/${entry.id}`).expect(409);
  });
});

describe('project timesheet', () => {
  it('aggregates inclusive dates by task and collaborator and restricts project access', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    const entries = `/api/v1/tasks/${task.id}/time-entries`;
    await f.dev.browser
      .post(entries)
      .send({ minutes: 30, spentOn: '2026-11-01', note: 'Private note' })
      .expect(201);
    await f.dev.browser.post(entries).send({ minutes: 45, spentOn: '2026-11-07' }).expect(201);
    await f.admin.browser.post(entries).send({ minutes: 120, spentOn: '2026-11-05' }).expect(201);
    await f.dev.browser.post(entries).send({ minutes: 60, spentOn: '2026-11-08' }).expect(201);
    const path = `/api/v1/projects/${f.project}/timesheet`;
    const query = '?from=2026-11-01&to=2026-11-07';
    const response = await f.dev.browser.get(path + query).expect(200);
    expect(response.body.data.rows).toMatchObject([
      { taskId: task.id, user: { id: f.admin.id }, minutes: 120 },
      { taskId: task.id, user: { id: f.dev.id }, minutes: 75 },
    ]);
    expect(JSON.stringify(response.body.data)).not.toContain('Private note');
    await f.bystander.browser.get(path + query).expect(404);
    await f.dev.browser.get(path + '?from=2026-11-08&to=2026-11-07').expect(400);
  });
});

describe('task timers', () => {
  const active = '/api/v1/time-tracker/active';
  const spentOn = '2026-11-10';

  it('restores the active timer and logs it once when stop is retried', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    const { browser } = f.dev;
    await f.outsider.browser.post(`/api/v1/tasks/${task.id}/timer`).send({ spentOn }).expect(404);
    const started = await browser
      .post(`/api/v1/tasks/${task.id}/timer`)
      .send({ spentOn })
      .expect(201);
    const { timer } = started.body.data;
    expect(timer).toMatchObject({ taskId: task.id, projectId: f.project, canStop: true });
    expect((await browser.get(active).expect(200)).body.data.timer).toEqual(timer);
    expect((await f.admin.browser.get(active).expect(200)).body.data.timer).toBeNull();
    await f.admin.browser.post(`/api/v1/time-tracker/${timer.id}/stop`).expect(409);

    const stop = `/api/v1/time-tracker/${timer.id}/stop`;
    await browser.post(stop).expect(204);
    await browser.post(stop).expect(204);
    expect((await browser.get(active).expect(200)).body.data.timer).toBeNull();
    const list = await browser.get(`/api/v1/tasks/${task.id}/time-entries`).expect(200);
    expect(list.body.data.entries).toHaveLength(1);
    expect(list.body.data.entries[0]).toMatchObject({ id: timer.id, minutes: 1, spentOn });
  });

  it('requires the current timer to switch tasks and can discard the new timer', async () => {
    const f = await projectFixture(t);
    const first = await newTask(f);
    const second = await newTask(f, { title: 'Signup page' });
    const { browser } = f.dev;
    const started = await browser
      .post(`/api/v1/tasks/${first.id}/timer`)
      .send({ spentOn })
      .expect(201);
    const path = `/api/v1/tasks/${second.id}/timer`;
    await browser.post(path).send({ spentOn }).expect(409);
    const body = { spentOn, replaceTimerId: started.body.data.timer.id };
    const switched = await browser.post(path).send(body).expect(201);
    const retry = await browser.post(path).send(body).expect(201);
    expect(retry.body.data.timer).toEqual(switched.body.data.timer);
    const list = await browser.get(`/api/v1/tasks/${first.id}/time-entries`).expect(200);
    expect(list.body.data.entries).toHaveLength(1);

    await browser.delete(`/api/v1/time-tracker/${switched.body.data.timer.id}`).expect(204);
    expect((await browser.get(active).expect(200)).body.data.timer).toBeNull();
    const secondList = await browser.get(`/api/v1/tasks/${second.id}/time-entries`).expect(200);
    expect(secondList.body.data.entries).toEqual([]);
  });
});

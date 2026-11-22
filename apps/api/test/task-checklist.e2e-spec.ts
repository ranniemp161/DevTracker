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

async function newTask(f: Fixture) {
  const res = await f.dev.browser
    .post(`/api/v1/projects/${f.project}/tasks`)
    .send({ title: 'Login page' })
    .expect(201);
  return res.body.data.task as { id: string; checklist: { done: number; total: number } };
}

describe('task checklist (0018)', () => {
  it('adds, ticks, edits, reorders and removes items, with counts on the task', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    expect(task.checklist).toEqual({ done: 0, total: 0 });
    const base = `/api/v1/tasks/${task.id}/checklist`;

    const add = async (body: string) =>
      (await f.dev.browser.post(base).send({ body }).expect(201)).body.data.item as {
        id: string;
        body: string;
        position: number;
        done: boolean;
      };
    const a = await add('  Write tests  ');
    const b = await add('Update docs');
    const c = await add('Ship it');
    expect([a.body, a.position, b.position, c.position, a.done]).toEqual([
      'Write tests',
      0,
      1,
      2,
      false,
    ]);

    const ticked = await f.dev.browser
      .patch(`/api/v1/checklist-items/${a.id}`)
      .send({ done: true })
      .expect(200);
    expect(ticked.body.data.item).toMatchObject({ done: true, doneBy: { id: f.dev.id } });

    // Counts reach the board and the task view.
    const board = await f.dev.browser.get(`/api/v1/projects/${f.project}/tasks`).expect(200);
    expect(board.body.data[0].checklist).toEqual({ done: 1, total: 3 });

    await f.dev.browser
      .patch(`/api/v1/checklist-items/${b.id}`)
      .send({ body: 'Update the README', assigneeId: f.dev.id })
      .expect(200);

    const reordered = await f.dev.browser
      .put(`${base}/order`)
      .send({ itemIds: [c.id, a.id, b.id] })
      .expect(200);
    expect(reordered.body.data.items.map((i: { body: string }) => i.body)).toEqual([
      'Ship it',
      'Write tests',
      'Update the README',
    ]);
    expect(reordered.body.data.items[2].assignee.id).toBe(f.dev.id);

    // A stale order (missing an item) is refused.
    await f.dev.browser
      .put(`${base}/order`)
      .send({ itemIds: [c.id, a.id] })
      .expect(409);

    await f.dev.browser.delete(`/api/v1/checklist-items/${c.id}`).expect(204);
    const list = await f.dev.browser.get(base).expect(200);
    expect(list.body.data.items).toHaveLength(2);
    const view = await f.dev.browser.get(`/api/v1/tasks/${task.id}`).expect(200);
    expect(view.body.data.task.checklist).toEqual({ done: 1, total: 2 });

    // Activity records add, complete and remove, without the item text.
    const activity = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity`).expect(200);
    const actions = activity.body.data.map((e: { action: string }) => e.action);
    expect(actions.filter((x: string) => x === 'task.checklist_item_added')).toHaveLength(3);
    expect(actions).toContain('task.checklist_item_completed');
    expect(actions).toContain('task.checklist_item_removed');
    expect(JSON.stringify(activity.body.data)).not.toContain('Write tests');
  });

  it('checks input, membership and access', async () => {
    const f = await projectFixture(t);
    const task = await newTask(f);
    const base = `/api/v1/tasks/${task.id}/checklist`;

    await f.dev.browser.post(base).send({ body: '   ' }).expect(400);
    await f.dev.browser
      .post(base)
      .send({ body: 'x'.repeat(501) })
      .expect(400);
    // Only project members can be assigned.
    await f.dev.browser.post(base).send({ body: 'Review', assigneeId: f.bystander.id }).expect(400);

    const item = (await f.dev.browser.post(base).send({ body: 'Review' }).expect(201)).body.data
      .item as { id: string };
    // Not on the project: the task and its items don't exist for them.
    await f.bystander.browser.get(base).expect(404);
    await f.bystander.browser
      .patch(`/api/v1/checklist-items/${item.id}`)
      .send({ done: true })
      .expect(404);
    await f.outsider.browser.delete(`/api/v1/checklist-items/${item.id}`).expect(404);
    await f.dev.browser.patch(`/api/v1/checklist-items/${item.id}`).send({}).expect(400);
  });
});

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
type Relation = { relationId: string; kind: string; task: { key: string } };

async function newTask(f: Fixture, title: string, project = f.project) {
  const res = await f.owner.browser
    .post(`/api/v1/projects/${project}/tasks`)
    .send({ title })
    .expect(201);
  return res.body.data.task as { id: string; key: string };
}

const summary = (relations: Relation[]) => relations.map((r) => `${r.kind} ${r.task.key}`);

describe('task relations (0020)', () => {
  it('links blocks, blocked by and related, shows both sides, and counts open blockers', async () => {
    const f = await projectFixture(t);
    const a = await newTask(f, 'API');
    const b = await newTask(f, 'UI');
    const c = await newTask(f, 'Docs');
    const rel = (id: string) => `/api/v1/tasks/${id}/relations`;

    await f.dev.browser.post(rel(b.id)).send({ kind: 'BLOCKED_BY', taskId: a.id }).expect(201);
    const added = await f.dev.browser
      .post(rel(b.id))
      .send({ kind: 'RELATES', taskId: c.id })
      .expect(201);
    expect(summary(added.body.data.relations)).toEqual([`BLOCKED_BY ${a.key}`, `RELATES ${c.key}`]);

    // The other side sees the mirror.
    const fromA = await f.dev.browser.get(rel(a.id)).expect(200);
    expect(summary(fromA.body.data.relations)).toEqual([`BLOCKS ${b.key}`]);
    const fromC = await f.dev.browser.get(rel(c.id)).expect(200);
    expect(summary(fromC.body.data.relations)).toEqual([`RELATES ${b.key}`]);

    // Duplicates from either side, the reverse block, and self-links are refused.
    await f.dev.browser.post(rel(c.id)).send({ kind: 'RELATES', taskId: b.id }).expect(409);
    await f.dev.browser.post(rel(a.id)).send({ kind: 'BLOCKS', taskId: b.id }).expect(409);
    await f.dev.browser.post(rel(a.id)).send({ kind: 'BLOCKED_BY', taskId: b.id }).expect(409);
    await f.dev.browser.post(rel(a.id)).send({ kind: 'RELATES', taskId: a.id }).expect(409);

    // Board: B has one open blocker until A is done.
    const blocked = async () => {
      const board = await f.dev.browser.get(`/api/v1/projects/${f.project}/tasks`).expect(200);
      return board.body.data.find((x: { id: string }) => x.id === b.id).blockedByCount;
    };
    expect(await blocked()).toBe(1);
    await f.dev.browser.patch(`/api/v1/tasks/${a.id}/status`).send({ status: 'DONE' }).expect(200);
    expect(await blocked()).toBe(0);

    // Activity on both tasks, worded from each side.
    const activity = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity`).expect(200);
    const added2 = activity.body.data.filter(
      (e: { action: string }) => e.action === 'task.relation_added',
    );
    expect(
      added2.map((e: { metadata: { key: string; relation: string; relatedKey: string } }) =>
        [e.metadata.key, e.metadata.relation, e.metadata.relatedKey].join(' '),
      ),
    ).toEqual(
      expect.arrayContaining([
        `${b.key} blocked_by ${a.key}`,
        `${a.key} blocks ${b.key}`,
        `${b.key} relates ${c.key}`,
        `${c.key} relates ${b.key}`,
      ]),
    );

    // Removing from either side deletes the one relation.
    const relationId = fromC.body.data.relations[0].relationId;
    await f.dev.browser.delete(`${rel(c.id)}/${relationId}`).expect(204);
    const after = await f.dev.browser.get(rel(b.id)).expect(200);
    expect(summary(after.body.data.relations)).toEqual([`BLOCKED_BY ${a.key}`]);
    await f.dev.browser.delete(`${rel(c.id)}/${relationId}`).expect(404);
  });

  it('only links tasks the caller can see, and hides ones they cannot', async () => {
    const f = await projectFixture(t);
    const mine = await newTask(f, 'Mine');
    // A second project the dev is not a member of.
    const other = (
      await f.owner.browser
        .post(`/api/v1/workspaces/${f.ws}/projects`)
        .send({ name: 'Secret', key: 'SEC' })
        .expect(201)
    ).body.data.project.id as string;
    const hidden = await newTask(f, 'Hidden', other);

    await f.dev.browser
      .post(`/api/v1/tasks/${mine.id}/relations`)
      .send({ kind: 'RELATES', taskId: hidden.id })
      .expect(400);
    // The owner can link them; the dev then doesn't see the hidden side.
    await f.owner.browser
      .post(`/api/v1/tasks/${mine.id}/relations`)
      .send({ kind: 'BLOCKED_BY', taskId: hidden.id })
      .expect(201);
    const forDev = await f.dev.browser.get(`/api/v1/tasks/${mine.id}/relations`).expect(200);
    expect(forDev.body.data.relations).toEqual([]);
    const forOwner = await f.owner.browser.get(`/api/v1/tasks/${mine.id}/relations`).expect(200);
    expect(summary(forOwner.body.data.relations)).toEqual([`BLOCKED_BY ${hidden.key}`]);

    await f.outsider.browser.get(`/api/v1/tasks/${mine.id}/relations`).expect(404);
    await f.dev.browser
      .post(`/api/v1/tasks/${mine.id}/relations`)
      .send({ kind: 'SIDEWAYS', taskId: hidden.id })
      .expect(400);
  });
});

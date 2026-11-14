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
type Item =
  | { kind: 'comment'; comment: { id: string; body: string | null; deleted: boolean } }
  | { kind: 'activity'; entry: { action: string } };

async function setup() {
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
    await dev!.browser
      .post(`/api/v1/projects/${project}/tasks`)
      .send({ title: 'Timeline task' })
      .expect(201)
  ).body.data.task.id as string;
  return { owner: owner!, dev: dev!, outsider: outsider!, task };
}

const comment = async (u: U, task: string, body: string) =>
  (await u.browser.post(`/api/v1/tasks/${task}/comments`).send({ body }).expect(201)).body.data
    .comment.id as string;

const describeItem = (i: Item) =>
  i.kind === 'comment'
    ? `comment:${i.comment.deleted ? '(deleted)' : i.comment.body}`
    : `activity:${i.entry.action}`;

it('merges comments and history oldest first, without repeating comment activity', async () => {
  const { dev, outsider, task } = await setup();
  const first = await comment(dev, task, 'First thought');
  await dev.browser
    .patch(`/api/v1/tasks/${task}/status`)
    .send({ status: 'IN_PROGRESS' })
    .expect(200);
  await comment(dev, task, 'Second thought');
  await dev.browser.delete(`/api/v1/comments/${first}`).expect(204);
  await dev.browser
    .post(`/api/v1/tasks/${task}/assignees`)
    .send({ userIds: [dev.id] })
    .expect(200);

  const all = await dev.browser.get(`/api/v1/tasks/${task}/timeline`).expect(200);
  const items = all.body.data as Item[];
  const actions = items.map(describeItem);
  expect(actions[0]).toBe('activity:task.created');
  expect(actions[1]).toBe('comment:(deleted)');
  expect(actions.indexOf('comment:Second thought')).toBeGreaterThan(1);
  expect(actions.at(-1)).toBe('activity:task.assigned');
  expect(actions.filter((a) => a.startsWith('activity:comment.'))).toEqual([]);
  expect(items.filter((i) => i.kind === 'comment')).toHaveLength(2);
  expect(all.body.meta).toMatchObject({ hasMore: false, nextCursor: null });

  // Comments only.
  const onlyComments = await dev.browser.get(`/api/v1/tasks/${task}/timeline?kind=comments`);
  expect((onlyComments.body.data as Item[]).map(describeItem)).toEqual([
    'comment:(deleted)',
    'comment:Second thought',
  ]);

  // Paging walks the same list with no gaps or repeats.
  const walked: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await dev.browser.get(
      `/api/v1/tasks/${task}/timeline?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(res.status).toBe(200);
    walked.push(...(res.body.data as Item[]).map(describeItem));
    cursor = res.body.meta.nextCursor;
  } while (cursor);
  expect(walked).toEqual(actions);

  expect((await dev.browser.get(`/api/v1/tasks/${task}/timeline?kind=nope`)).status).toBe(400);
  expect((await outsider.browser.get(`/api/v1/tasks/${task}/timeline`)).status).toBe(404);
});

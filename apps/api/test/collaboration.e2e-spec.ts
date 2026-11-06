import { activityLogs, comments, notifications, outboxEvents } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture, type TestUser } from './utils/fixtures';
import { EventRecorder } from '../src/events/event-recorder.service';
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

const newTask = async (u: TestUser, project: string, body: Record<string, unknown> = {}) =>
  (
    await u.browser
      .post(`/api/v1/projects/${project}/tasks`)
      .send({ title: 'Fix login', ...body })
      .expect(201)
  ).body.data.task as { id: string; key: string };

const comment = (u: TestUser, task: string, body: string) =>
  u.browser.post(`/api/v1/tasks/${task}/comments`).send({ body });

const inbox = async (u: TestUser) =>
  (await u.browser.get('/api/v1/notifications').expect(200)).body.data as {
    id: string;
    type: string;
    title: string;
    link: string;
    readAt: string | null;
  }[];

describe('comments', () => {
  it('creates, lists oldest first with pagination, and returns plain text', async () => {
    const { dev, admin, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    for (const body of ['first', 'second', '<script>alert(1)</script>']) {
      await comment(dev, task.id, body).expect(201);
    }
    await comment(admin, task.id, 'admin note').expect(201);

    const page1 = await dev.browser.get(`/api/v1/tasks/${task.id}/comments?limit=2`).expect(200);
    expect(page1.body.data.map((c: { body: string }) => c.body)).toEqual(['first', 'second']);
    expect(page1.body.meta.hasMore).toBe(true);
    const page2 = await dev.browser.get(
      `/api/v1/tasks/${task.id}/comments?limit=2&cursor=${page1.body.meta.nextCursor}`,
    );
    expect(page2.body.data.map((c: { body: string }) => c.body)).toEqual([
      '<script>alert(1)</script>',
      'admin note',
    ]);
    expect(page2.body.meta.hasMore).toBe(false);
    expect(page2.body.data[1]).toMatchObject({
      author: { username: 'admin' },
      deleted: false,
      edited: false,
    });
  });

  it('only the author edits; author or admin deletes; deleted comments stay as placeholders', async () => {
    const { dev, admin, owner, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    const mine = (await comment(dev, task.id, 'draft').expect(201)).body.data.comment.id;
    const theirs = (await comment(owner, task.id, 'owner says').expect(201)).body.data.comment.id;

    expect(
      (await admin.browser.patch(`/api/v1/comments/${mine}`).send({ body: 'hijack' })).status,
    ).toBe(403);
    const edited = await dev.browser.patch(`/api/v1/comments/${mine}`).send({ body: 'final' });
    expect(edited.body.data.comment).toMatchObject({ body: 'final', edited: true });

    expect((await dev.browser.delete(`/api/v1/comments/${theirs}`)).status).toBe(403);
    await admin.browser.delete(`/api/v1/comments/${theirs}`).expect(204); // moderation
    await dev.browser.delete(`/api/v1/comments/${mine}`).expect(204);
    expect((await dev.browser.delete(`/api/v1/comments/${mine}`)).status).toBe(404);
    expect((await dev.browser.patch(`/api/v1/comments/${mine}`).send({ body: 'x' })).status).toBe(
      404,
    );

    const list = await dev.browser.get(`/api/v1/tasks/${task.id}/comments`);
    expect(
      list.body.data.map((c: { body: string | null; deleted: boolean }) => [c.body, c.deleted]),
    ).toEqual([
      [null, true],
      [null, true],
    ]);
    const rows = await t.db.select().from(comments);
    expect(rows).toHaveLength(2); // retained
  });

  it('hides comments from non-project members and outsiders; archived projects are read-only', async () => {
    const { dev, admin, bystander, outsider, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    const id = (await comment(dev, task.id, 'hello').expect(201)).body.data.comment.id;
    for (const u of [bystander, outsider]) {
      expect((await u.browser.get(`/api/v1/tasks/${task.id}/comments`)).status).toBe(404);
      expect((await comment(u, task.id, 'hi')).status).toBe(404);
      expect((await u.browser.delete(`/api/v1/comments/${id}`)).status).toBe(404);
    }
    await admin.browser.delete(`/api/v1/projects/${project}`).expect(204);
    expect((await comment(dev, task.id, 'late')).body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('mentions and notifications', () => {
  it('notifies mentioned users who can access the project, and ignores everyone else', async () => {
    const { dev, admin, owner, bystander, outsider, project } = await projectFixture(t);
    const task = await newTask(dev, project);

    const res = await comment(
      dev,
      task.id,
      '@admin @owner @bystander @outsider @dev @nobody please look',
    );
    expect(
      res.body.data.comment.mentions.map((m: { username: string }) => m.username).sort(),
    ).toEqual(['admin', 'dev', 'owner']);

    expect((await inbox(admin)).map((n) => n.type)).toEqual(['MENTIONED']);
    expect((await inbox(admin))[0]).toMatchObject({
      title: `@dev mentioned you on ${task.key}`,
      link: `/projects/${project}/tasks/${task.id}`,
    });
    expect(await inbox(owner)).toHaveLength(1);
    expect(await inbox(bystander)).toEqual([]); // not on the project
    expect(await inbox(outsider)).toEqual([]);
    expect(await inbox(dev)).toEqual([]); // never notified about own action
  });

  it('notifies newly added mentions on edit, once', async () => {
    const { dev, admin, owner, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    const id = (await comment(dev, task.id, 'hey @admin').expect(201)).body.data.comment.id;
    await dev.browser
      .patch(`/api/v1/comments/${id}`)
      .send({ body: 'hey @admin and @owner' })
      .expect(200);
    await dev.browser.patch(`/api/v1/comments/${id}`).send({ body: 'hey @owner' }).expect(200);

    expect(await inbox(admin)).toHaveLength(1);
    expect(await inbox(owner)).toHaveLength(1);
    const final = await dev.browser.get(`/api/v1/tasks/${task.id}/comments`);
    expect(final.body.data[0].mentions.map((m: { username: string }) => m.username)).toEqual([
      'owner',
    ]);
  });

  it('notifies the reporter and assignees of comments, without duplicating mentions', async () => {
    const { dev, admin, owner, project } = await projectFixture(t);
    const task = await newTask(owner, project, { assigneeIds: [dev.id] });
    // dev was notified of the assignment
    expect((await inbox(dev)).map((n) => n.type)).toEqual(['TASK_ASSIGNED']);
    expect((await inbox(dev))[0]!.title).toBe(`@owner assigned you to ${task.key}`);

    await comment(admin, task.id, 'looks good @dev').expect(201);
    expect((await inbox(dev)).map((n) => n.type)).toEqual(['MENTIONED', 'TASK_ASSIGNED']);
    expect((await inbox(owner)).map((n) => n.type)).toEqual(['COMMENT_RECEIVED']); // reporter
    expect(await inbox(admin)).toEqual([]);
  });

  it('notifies on later assignment, not on self-assignment', async () => {
    const { dev, admin, project } = await projectFixture(t);
    await admin.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: admin.id })
      .expect(201);
    const task = await newTask(dev, project);
    await dev.browser
      .post(`/api/v1/tasks/${task.id}/assignees`)
      .send({ userIds: [dev.id, admin.id] })
      .expect(200);
    expect(await inbox(dev)).toEqual([]);
    expect((await inbox(admin)).map((n) => n.type)).toEqual(['TASK_ASSIGNED']);
    // Re-adding existing assignees creates nothing new.
    await dev.browser
      .post(`/api/v1/tasks/${task.id}/assignees`)
      .send({ userIds: [admin.id] })
      .expect(200);
    expect(await inbox(admin)).toHaveLength(1);
  });

  it('notifies project members when a milestone is completed', async () => {
    const { dev, admin, owner, bystander, project } = await projectFixture(t);
    const id = (
      await admin.browser.post(`/api/v1/projects/${project}/milestones`).send({ name: 'Beta' })
    ).body.data.milestone.id;
    await admin.browser.patch(`/api/v1/milestones/${id}`).send({ status: 'COMPLETED' }).expect(200);
    await admin.browser.patch(`/api/v1/milestones/${id}`).send({ name: 'Beta 1' }).expect(200); // no re-notify

    for (const u of [dev, owner]) {
      expect((await inbox(u)).map((n) => [n.type, n.title])).toEqual([
        ['MILESTONE_COMPLETED', 'Milestone "Beta" completed in DEV'],
      ]);
    }
    expect(await inbox(admin)).toEqual([]);
    expect(await inbox(bystander)).toEqual([]);
  });

  it('marks one or all as read, counts unread, and keeps notifications private', async () => {
    const { dev, admin, owner, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    await comment(dev, task.id, '@admin one').expect(201);
    await comment(dev, task.id, '@admin two').expect(201);
    await comment(dev, task.id, '@admin three').expect(201);

    const count = async () =>
      (await admin.browser.get('/api/v1/notifications/unread-count')).body.data.count;
    expect(await count()).toBe(3);
    const [latest] = await inbox(admin);
    expect((await owner.browser.patch(`/api/v1/notifications/${latest!.id}/read`)).status).toBe(
      404,
    );

    const read = await admin.browser.patch(`/api/v1/notifications/${latest!.id}/read`).expect(200);
    expect(read.body.data.notification.readAt).toEqual(expect.any(String));
    expect(await count()).toBe(2);
    const unread = await admin.browser.get('/api/v1/notifications?unreadOnly=true');
    expect(unread.body.data).toHaveLength(2);

    expect((await admin.browser.post('/api/v1/notifications/read-all')).body.data).toEqual({
      updated: 2,
    });
    expect(await count()).toBe(0);

    const page = await admin.browser.get('/api/v1/notifications?limit=2');
    expect(page.body.meta.hasMore).toBe(true);
    const rest = await admin.browser.get(
      `/api/v1/notifications?limit=2&cursor=${page.body.meta.nextCursor}`,
    );
    expect(rest.body.data).toHaveLength(1);
  });

  it('hides notifications from workspaces the user has left', async () => {
    const { dev, admin, owner, ws, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    await comment(dev, task.id, '@admin ping').expect(201);
    expect(await inbox(admin)).toHaveLength(1);
    await owner.browser.delete(`/api/v1/workspaces/${ws}/members/${admin.id}`).expect(204);
    expect(await inbox(admin)).toEqual([]);
    expect((await admin.browser.get('/api/v1/notifications/unread-count')).body.data.count).toBe(0);
  });
});

describe('activity feed', () => {
  it('records task, comment, project and milestone activity with minimal metadata', async () => {
    const { dev, admin, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    await dev.browser
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ status: 'IN_PROGRESS', description: 'secret plan details' })
      .expect(200);
    await dev.browser.patch(`/api/v1/tasks/${task.id}`).send({ status: 'IN_PROGRESS' }).expect(200); // no-op
    await dev.browser
      .post(`/api/v1/tasks/${task.id}/assignees`)
      .send({ userIds: [dev.id] })
      .expect(200);
    const c = (await comment(dev, task.id, 'confidential remark').expect(201)).body.data.comment.id;
    await dev.browser.delete(`/api/v1/comments/${c}`).expect(204);
    await dev.browser.delete(`/api/v1/tasks/${task.id}`).expect(204);
    const m = (
      await admin.browser.post(`/api/v1/projects/${project}/milestones`).send({ name: 'Beta' })
    ).body.data.milestone.id;
    await admin.browser.patch(`/api/v1/milestones/${m}`).send({ status: 'COMPLETED' }).expect(200);

    const feed = await dev.browser.get(`/api/v1/projects/${project}/activity?limit=50`).expect(200);
    const actions = feed.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual([
      'milestone.completed',
      'task.deleted',
      'comment.deleted',
      'comment.created',
      'task.assigned',
      'task.updated',
      'task.created',
      'project.member_added',
      'project.created',
    ]);
    const updated = feed.body.data.find((e: { action: string }) => e.action === 'task.updated');
    expect(updated).toMatchObject({
      actor: { username: 'dev' },
      task: { key: 'DEV-1', title: 'Fix login' },
      metadata: {
        changes: { status: { from: 'TODO', to: 'IN_PROGRESS' }, description: { changed: true } },
      },
    });
    // No description or comment text leaks into activity metadata (§8.4, M4 rule 3).
    const raw = JSON.stringify(await t.db.select().from(activityLogs));
    expect(raw).not.toContain('secret plan details');
    expect(raw).not.toContain('confidential remark');
  });

  it('filters by task, paginates, and hides the feed from non-members', async () => {
    const { dev, bystander, project } = await projectFixture(t);
    const a = await newTask(dev, project);
    await newTask(dev, project);
    await comment(dev, a.id, 'x').expect(201);

    const forA = await dev.browser.get(`/api/v1/projects/${project}/activity?taskId=${a.id}`);
    expect(forA.body.data.map((e: { action: string }) => e.action)).toEqual([
      'comment.created',
      'task.created',
    ]);

    const p1 = await dev.browser.get(`/api/v1/projects/${project}/activity?limit=2`);
    const p2 = await dev.browser.get(
      `/api/v1/projects/${project}/activity?limit=2&cursor=${p1.body.meta.nextCursor}`,
    );
    const ids = [...p1.body.data, ...p2.body.data].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(4);

    expect((await bystander.browser.get(`/api/v1/projects/${project}/activity`)).status).toBe(404);
  });
});

describe('transactional outbox (architecture §10)', () => {
  it('writes outbox events with the business change, in the §10 envelope', async () => {
    const { dev, project } = await projectFixture(t);
    const task = await newTask(dev, project);
    await comment(dev, task.id, '@admin hi').expect(201);

    const events = await t.db.select().from(outboxEvents);
    const types = events.map((e) => e.eventType);
    for (const type of [
      'task.created',
      'comment.created',
      'activity.created',
      'notification.created',
    ]) {
      expect(types).toContain(type);
    }
    expect(events.every((e) => e.publishedAt === null && e.attempts === 0)).toBe(true);
    const created = events.find((e) => e.eventType === 'comment.created')!;
    expect(created.payload).toMatchObject({
      type: 'comment.created',
      version: 1,
      projectId: project,
      actor: { id: dev.id },
      entity: { type: 'comment' },
      payload: { taskId: task.id },
    });
    expect(JSON.stringify(events)).not.toContain('@admin hi'); // no comment text in events
  });

  it('rolls back activity, notifications and outbox rows with a failed transaction', async () => {
    const { dev, admin, ws, project } = await projectFixture(t);
    const recorder = t.app.get(EventRecorder);
    const count = async () => [
      (await t.db.select().from(activityLogs)).length,
      (await t.db.select().from(notifications)).length,
      (await t.db.select().from(outboxEvents)).length,
    ];
    const before = await count();

    await expect(
      t.db.transaction(async (tx) => {
        await recorder.activity(tx, {
          workspaceId: ws,
          projectId: project,
          actor: { id: dev.id, username: dev.username },
          entity: { type: 'project', id: project },
          action: 'project.updated',
          event: { type: 'project.updated', payload: {} },
        });
        await recorder.notify(tx, null, [
          {
            userId: admin.id,
            workspaceId: ws,
            projectId: project,
            type: 'MENTIONED',
            title: 'x',
            resourceType: 'project',
            resourceId: project,
          },
        ]);
        throw new Error('business change failed');
      }),
    ).rejects.toThrow('business change failed');

    expect(await count()).toEqual(before);
  });
});

import { outboxEvents, projectMessages } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture, type TestUser } from './utils/fixtures';
import { createTestApp, registerUser, type TestApp } from './utils/test-app';

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

const sendMsg = (
  u: TestUser,
  projectId: string,
  body: string,
  clientRequestId = `req-${Math.random().toString(36).slice(2)}`,
  taskId?: string,
) =>
  u.browser
    .post(`/api/v1/projects/${projectId}/messages`)
    .send({ body, clientRequestId, ...(taskId ? { taskId } : {}) });

const listMsgs = (u: TestUser, projectId: string, query = '') =>
  u.browser.get(`/api/v1/projects/${projectId}/messages${query ? `?${query}` : ''}`);

const markRead = (u: TestUser, projectId: string, sequence: number) =>
  u.browser.put(`/api/v1/projects/${projectId}/chat/read`).send({ sequence });

const unreadSummary = (u: TestUser, workspaceId: string) =>
  u.browser.get(`/api/v1/workspaces/${workspaceId}/chat/unread`);

const newTask = async (u: TestUser, projectId: string) =>
  (
    await u.browser
      .post(`/api/v1/projects/${projectId}/tasks`)
      .send({ title: 'Task for chat' })
      .expect(201)
  ).body.data.task as { id: string; key: string };

describe('project chat', () => {
  it('member and admin can send, list, and observe monotonically increasing sequences', async () => {
    const { dev, admin, project } = await projectFixture(t);

    const m1 = await sendMsg(dev, project, 'First message', 'req-1').expect(201);
    expect(m1.body.data.message).toMatchObject({
      sequence: 1,
      body: 'First message',
      deleted: false,
      edited: false,
      author: { username: 'dev' },
    });

    const m2 = await sendMsg(admin, project, 'Second message', 'req-2').expect(201);
    expect(m2.body.data.message.sequence).toBe(2);

    const list = await listMsgs(dev, project).expect(200);
    expect(list.body.data.messages).toHaveLength(2);
    expect(list.body.data.messages[0].sequence).toBe(1);
    expect(list.body.data.messages[1].sequence).toBe(2);
    expect(list.body.data.hasMoreBefore).toBe(false);
    expect(list.body.data.hasMoreAfter).toBe(false);
  });

  it('enforces access control: member/admin allowed; bystander, outsider and unverified rejected', async () => {
    const { dev, admin, bystander, outsider, project } = await projectFixture(t);

    await sendMsg(dev, project, 'Hello').expect(201);
    await listMsgs(admin, project).expect(200);

    // Bystander (workspace member, but not project member) gets 404
    await sendMsg(bystander, project, 'Sneak in').expect(404);
    await listMsgs(bystander, project).expect(404);

    // Outsider gets 404
    await sendMsg(outsider, project, 'Sneak in').expect(404);
    await listMsgs(outsider, project).expect(404);

    // Unverified user
    const unverifiedBrowser = t.browser();
    await registerUser(unverifiedBrowser, { username: 'unverified', email: 'unver@example.com' });
    await unverifiedBrowser.get(`/api/v1/projects/${project}/messages`).expect(403);
  });

  it('archived projects are read-only: reading history allowed, sending/editing/deleting rejected', async () => {
    const { owner, dev, project } = await projectFixture(t);

    const msg = (await sendMsg(dev, project, 'Before archive').expect(201)).body.data.message;

    // Archive project
    await owner.browser.delete(`/api/v1/projects/${project}`).expect(204);

    // Read history remains allowed
    const list = await listMsgs(dev, project).expect(200);
    expect(list.body.data.messages).toHaveLength(1);

    // Creation rejected with 409 PROJECT_ARCHIVED
    const postRes = await sendMsg(dev, project, 'After archive');
    expect(postRes.status).toBe(409);
    expect(postRes.body.error.code).toBe('PROJECT_ARCHIVED');

    // Edit rejected
    const patchRes = await dev.browser
      .patch(`/api/v1/messages/${msg.id}`)
      .send({ body: 'Edited after archive' });
    expect(patchRes.status).toBe(409);

    // Delete rejected
    const delRes = await dev.browser.delete(`/api/v1/messages/${msg.id}`);
    expect(delRes.status).toBe(409);
  });

  it('handles idempotency and retries cleanly', async () => {
    const { dev, project } = await projectFixture(t);

    // First send
    const res1 = await sendMsg(dev, project, 'Idempotent msg', 'client-req-abc').expect(201);
    const msgId = res1.body.data.message.id;

    // Retry with identical content returns existing message
    const res2 = await sendMsg(dev, project, 'Idempotent msg', 'client-req-abc').expect(201);
    expect(res2.body.data.message.id).toBe(msgId);
    expect(res2.body.data.message.sequence).toBe(res1.body.data.message.sequence);

    // Retry with different content returns 409 Conflict
    const res3 = await sendMsg(dev, project, 'Tampered content', 'client-req-abc');
    expect(res3.status).toBe(409);
    expect(res3.body.error.code).toBe('CONFLICT');

    // Only 1 row stored in database
    const rows = await t.db.select().from(projectMessages);
    expect(rows).toHaveLength(1);
  });

  it('supports pagination with before, after, and around deep linking', async () => {
    const { dev, project } = await projectFixture(t);

    const createdIds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const res = await sendMsg(dev, project, `Message ${i}`, `req-${i}`).expect(201);
      createdIds.push(res.body.data.message.id);
    }

    // Default limit 5
    const latestPage = await listMsgs(dev, project, 'limit=5').expect(200);
    expect(latestPage.body.data.messages).toHaveLength(5);
    expect(latestPage.body.data.messages.map((m: { sequence: number }) => m.sequence)).toEqual([
      6, 7, 8, 9, 10,
    ]);
    expect(latestPage.body.data.hasMoreBefore).toBe(true);
    expect(latestPage.body.data.hasMoreAfter).toBe(false);

    // Before sequence 6
    const beforePage = await listMsgs(dev, project, 'before=6&limit=3').expect(200);
    expect(beforePage.body.data.messages.map((m: { sequence: number }) => m.sequence)).toEqual([
      3, 4, 5,
    ]);
    expect(beforePage.body.data.hasMoreBefore).toBe(true);

    // After sequence 7
    const afterPage = await listMsgs(dev, project, 'after=7&limit=2').expect(200);
    expect(afterPage.body.data.messages.map((m: { sequence: number }) => m.sequence)).toEqual([
      8, 9,
    ]);
    expect(afterPage.body.data.hasMoreAfter).toBe(true);

    // Around deep link: around message 5
    const targetId = createdIds[4]!; // Message 5 (sequence 5)
    const aroundPage = await listMsgs(dev, project, `around=${targetId}&limit=5`).expect(200);
    const sequences = aroundPage.body.data.messages.map((m: { sequence: number }) => m.sequence);
    expect(sequences).toContain(5);
    expect(aroundPage.body.data.messages.some((m: { id: string }) => m.id === targetId)).toBe(true);

    // Inaccessible deep link message ID (nonexistent UUID)
    await listMsgs(dev, project, 'around=a0000000-0000-4000-8000-000000000099').expect(404);
  });

  it('author can edit; non-author forbidden; notifies newly added mentions only', async () => {
    const { dev, admin, owner, project } = await projectFixture(t);

    const msg = (await sendMsg(dev, project, 'Draft @admin', 'req-edit').expect(201)).body.data
      .message;

    // Initial mention check: admin notified
    const adminInbox1 = (await admin.browser.get('/api/v1/notifications').expect(200)).body.data;
    expect(adminInbox1).toHaveLength(1);
    expect(adminInbox1[0].resourceType).toBe('chat_message');
    expect(adminInbox1[0].link).toBe(`/projects/${project}/chat?message=${msg.id}`);
    expect(adminInbox1[0].body).not.toContain('Draft'); // Message body never in notification!

    // Non-author edit forbidden
    await admin.browser.patch(`/api/v1/messages/${msg.id}`).send({ body: 'Hijack' }).expect(403);

    // Author edits, adding @owner and keeping @admin
    const updated = await dev.browser
      .patch(`/api/v1/messages/${msg.id}`)
      .send({ body: 'Updated @admin @owner' })
      .expect(200);
    expect(updated.body.data.message.edited).toBe(true);
    expect(updated.body.data.message.body).toBe('Updated @admin @owner');

    // Admin should NOT receive duplicate notification
    const adminInbox2 = (await admin.browser.get('/api/v1/notifications').expect(200)).body.data;
    expect(adminInbox2).toHaveLength(1);

    // Owner should receive notification
    const ownerInbox = (await owner.browser.get('/api/v1/notifications').expect(200)).body.data;
    expect(ownerInbox).toHaveLength(1);
    expect(ownerInbox[0].resourceType).toBe('chat_message');
  });

  it('author or admin/owner can delete; non-author member forbidden; soft-deletes placeholder', async () => {
    const { dev, admin, project } = await projectFixture(t);

    const devMsg = (await sendMsg(dev, project, 'Secret msg', 'req-del-1').expect(201)).body.data
      .message;
    const adminMsg = (await sendMsg(admin, project, 'Admin msg', 'req-del-2').expect(201)).body.data
      .message;

    // Dev cannot delete admin's message
    await dev.browser.delete(`/api/v1/messages/${adminMsg.id}`).expect(403);

    // Admin can delete dev's message (moderation)
    await admin.browser.delete(`/api/v1/messages/${devMsg.id}`).expect(204);

    // Dev can delete own message (after new send)
    const devMsg2 = (await sendMsg(dev, project, 'My other msg', 'req-del-3').expect(201)).body.data
      .message;
    await dev.browser.delete(`/api/v1/messages/${devMsg2.id}`).expect(204);

    // Listing shows soft-deleted placeholders
    const list = await listMsgs(dev, project).expect(200);
    const deletedPlaceholder = list.body.data.messages.find(
      (m: { id: string }) => m.id === devMsg.id,
    );
    expect(deletedPlaceholder).toMatchObject({
      deleted: true,
      body: null,
      task: null,
      mentions: [],
    });
  });

  it('links live task in same project; validates task; clears task if deleted', async () => {
    const { dev, project } = await projectFixture(t);
    const task = await newTask(dev, project);

    // Valid task link
    const msg = (await sendMsg(dev, project, 'Review this task', 'req-task-1', task.id).expect(201))
      .body.data.message;
    expect(msg.task).toMatchObject({
      id: task.id,
      title: 'Task for chat',
    });

    // Invalid task link (non-existent UUID)
    await sendMsg(
      dev,
      project,
      'Bad task',
      'req-task-2',
      '00000000-0000-0000-0000-000000000099',
    ).expect(400);

    // Soft delete the task -> message renders task as null (unavailable placeholder)
    await dev.browser.delete(`/api/v1/tasks/${task.id}`).expect(204);
    const refreshed = await listMsgs(dev, project).expect(200);
    const msgAfterTaskDelete = refreshed.body.data.messages.find(
      (m: { id: string }) => m.id === msg.id,
    );
    expect(msgAfterTaskDelete.task).toBeNull();
  });

  it('manages read state and workspace unread counts accurately', async () => {
    const { dev, admin, ws, project } = await projectFixture(t);

    // Initially 0 unread for admin
    const initialUnread = (await unreadSummary(admin, ws).expect(200)).body.data;
    const projUnread0 = initialUnread.find((u: { projectId: string }) => u.projectId === project);
    expect(projUnread0?.unreadCount ?? 0).toBe(0);

    // Dev sends 3 messages
    await sendMsg(dev, project, 'Msg 1', 'req-u-1').expect(201);
    await sendMsg(dev, project, 'Msg 2', 'req-u-2').expect(201);
    await sendMsg(dev, project, 'Msg 3', 'req-u-3').expect(201);

    // Admin should see 3 unread
    const adminUnread1 = (await unreadSummary(admin, ws).expect(200)).body.data;
    const adminProjUnread1 = adminUnread1.find(
      (u: { projectId: string }) => u.projectId === project,
    );
    expect(adminProjUnread1?.unreadCount).toBe(3);

    // Dev (author) should see 0 unread (self-messages don't count)
    const devUnread = (await unreadSummary(dev, ws).expect(200)).body.data;
    const devProjUnread = devUnread.find((u: { projectId: string }) => u.projectId === project);
    expect(devProjUnread?.unreadCount).toBe(0);

    // Admin marks read up to sequence 2
    const readRes = await markRead(admin, project, 2).expect(200);
    expect(readRes.body.data.readState.lastReadSequence).toBe(2);

    // Admin unread count is now 1 (sequence 3 remains unread)
    const adminUnread2 = (await unreadSummary(admin, ws).expect(200)).body.data;
    const adminProjUnread2 = adminUnread2.find(
      (u: { projectId: string }) => u.projectId === project,
    );
    expect(adminProjUnread2?.unreadCount).toBe(1);

    // Monotonic advance: marking lower sequence (1) does NOT regress read state
    await markRead(admin, project, 1).expect(200);
    const adminUnread3 = (await unreadSummary(admin, ws).expect(200)).body.data;
    const adminProjUnread3 = adminUnread3.find(
      (u: { projectId: string }) => u.projectId === project,
    );
    expect(adminProjUnread3?.unreadCount).toBe(1);

    // Admin marks sequence 3 -> unread is 0
    await markRead(admin, project, 3).expect(200);
    const adminUnread4 = (await unreadSummary(admin, ws).expect(200)).body.data;
    const adminProjUnread4 = adminUnread4.find(
      (u: { projectId: string }) => u.projectId === project,
    );
    expect(adminProjUnread4?.unreadCount).toBe(0);
  });

  it('revoked member chat notifications are filtered out', async () => {
    const { owner, dev, admin, project } = await projectFixture(t);

    // Admin mentions dev
    await sendMsg(admin, project, 'Hello @dev').expect(201);
    const devInboxBefore = (await dev.browser.get('/api/v1/notifications').expect(200)).body.data;
    expect(devInboxBefore).toHaveLength(1);

    // Remove dev from project membership
    await owner.browser.delete(`/api/v1/projects/${project}/members/${dev.id}`).expect(204);

    // Dev no longer sees the chat notification for that project
    const devInboxAfter = (await dev.browser.get('/api/v1/notifications').expect(200)).body.data;
    expect(devInboxAfter).toHaveLength(0);
  });

  it('writes outbox events with identifiers only (no message bodies)', async () => {
    const { dev, project } = await projectFixture(t);

    const msg = (
      await sendMsg(dev, project, 'Super sensitive secret body text', 'req-sens-1').expect(201)
    ).body.data.message;

    const outbox = await t.db.select().from(outboxEvents);
    const createdEvent = outbox.find((e) => e.eventType === 'chat.message.created');
    expect(createdEvent).toBeDefined();

    const payloadStr = JSON.stringify(createdEvent!.payload);
    expect(payloadStr).not.toContain('Super sensitive secret body text');
    expect(createdEvent!.payload).toMatchObject({
      type: 'chat.message.created',
      payload: {
        messageId: msg.id,
        sequence: msg.sequence,
        projectId: project,
      },
    });
  });

  it('concurrent sends with the same clientRequestId produce exactly one message', async () => {
    const { dev, project } = await projectFixture(t);

    const [r1, r2] = await Promise.all([
      sendMsg(dev, project, 'Concurrent test', 'req-conc-1'),
      sendMsg(dev, project, 'Concurrent test', 'req-conc-1'),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.data.message.id).toBe(r2.body.data.message.id);

    const rows = await t.db.select().from(projectMessages);
    expect(rows).toHaveLength(1);
  });
});

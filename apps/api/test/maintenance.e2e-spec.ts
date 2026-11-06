import { githubWebhookDeliveries, notifications, outboxEvents, sessions } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, TEST_CRON_SECRET, type TestApp } from './utils/test-app';

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

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const cron = (path: string) =>
  t.http().get(`/api/v1/internal/${path}`).set('Authorization', `Bearer ${TEST_CRON_SECRET}`);

describe('retention cleanup', () => {
  it('requires the cron secret', async () => {
    await t.http().get('/api/v1/internal/maintenance/prune').expect(401);
    await t.http().get('/api/v1/internal/status').expect(401);
  });

  it('prunes operational data past its retention and keeps everything else', async () => {
    const { owner, dev, ws, project } = await projectFixture(t);
    // Product history that must survive.
    await owner.browser
      .post(`/api/v1/projects/${project}/tasks`)
      .send({ title: 'Kept', assigneeIds: [dev.id] })
      .expect(201);

    await t.db.insert(githubWebhookDeliveries).values([
      { deliveryId: 'old', eventType: 'push', processingStatus: 'PROCESSED', receivedAt: ago(31) },
      {
        deliveryId: 'recent',
        eventType: 'push',
        processingStatus: 'PROCESSED',
        receivedAt: ago(29),
      },
    ]);
    const aggregateId = dev.id;
    await t.db.insert(outboxEvents).values([
      { eventType: 'x', aggregateId, payload: {}, publishedAt: ago(8) },
      { eventType: 'x', aggregateId, payload: {}, publishedAt: ago(6) },
      { eventType: 'x', aggregateId, payload: {}, createdAt: ago(30) }, // unpublished: kept
    ]);
    const base = {
      userId: dev.id,
      workspaceId: ws,
      projectId: project,
      type: 'MENTIONED' as const,
      title: 't',
      resourceType: 'task',
      resourceId: project,
    };
    await t.db.insert(notifications).values([
      { ...base, readAt: ago(91) },
      { ...base, readAt: ago(10) },
      { ...base, createdAt: ago(400) }, // unread: kept
    ]);
    await t.db.insert(sessions).values({ userId: dev.id, tokenHash: 'expired', expiresAt: ago(1) });

    const outboxBefore = (await t.db.select().from(outboxEvents)).length;
    const notificationsBefore = (await t.db.select().from(notifications)).length;

    const res = await cron('maintenance/prune').expect(200);
    expect(res.body.data).toMatchObject({
      webhookDeliveries: 1,
      outboxEvents: 1,
      notifications: 1,
      sessions: 1,
    });
    expect((await t.db.select().from(githubWebhookDeliveries)).map((d) => d.deliveryId)).toEqual([
      'recent',
    ]);
    expect(await t.db.select().from(outboxEvents)).toHaveLength(outboxBefore - 1);
    expect(await t.db.select().from(notifications)).toHaveLength(notificationsBefore - 1);

    // Signed-in users keep their sessions; the task is still there.
    await dev.browser.get('/api/v1/auth/me').expect(200);
    const tasks = await dev.browser.get(`/api/v1/projects/${project}/tasks`).expect(200);
    expect(tasks.body.data).toHaveLength(1);
  });
});

describe('ops status', () => {
  it('reports the outbox backlog and webhook delivery health', async () => {
    const { dev } = await projectFixture(t);
    await t.db.insert(githubWebhookDeliveries).values([
      { deliveryId: 'f1', eventType: 'push', processingStatus: 'FAILED', attempts: 1 },
      {
        deliveryId: 'f2',
        eventType: 'push',
        processingStatus: 'FAILED',
        attempts: 5,
        lastAttemptAt: new Date(),
      },
      {
        deliveryId: 'f3',
        eventType: 'push',
        processingStatus: 'FAILED',
        attempts: 5,
        lastAttemptAt: ago(2),
      },
      { deliveryId: 'r1', eventType: 'push', processingStatus: 'RECEIVED' },
    ]);
    const res = await cron('status').expect(200);
    expect(res.body.data.webhooks).toEqual({
      failed: 3,
      retryable: 1,
      pending: 1,
      exhaustedLast24h: 1,
    });
    expect(res.body.data.outbox.unpublished).toBeGreaterThan(0); // invitations etc. from the fixture
    expect(res.body.data.outbox.oldestUnpublishedAt).toEqual(expect.any(String));
    void dev;
  });
});

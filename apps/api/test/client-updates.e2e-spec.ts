import { eq, taskRequests } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, TEST_PROXY_SECRET, type TestApp } from './utils/test-app';

/** Decision record 0028 §2: status emails to people who sent requests through the form. */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await t.reset();
});

type Fixture = Awaited<ReturnType<typeof projectFixture>>;
const CLIENT = 'client@example.com';

let ip = 0;
async function send(f: Fixture, title: string, email: string | null = CLIENT) {
  const form = await f.owner.browser
    .put(`/api/v1/projects/${f.project}/intake`)
    .send({ enabled: true })
    .expect(200);
  await t
    .http()
    .post(`/api/v1/public/requests/${form.body.data.intake.token}`)
    .set('x-devtrack-client-ip', `198.51.100.${(ip++ % 200) + 1}`)
    .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
    .send({ kind: 'request', title, ...(email ? { email } : {}) })
    .expect(202);
  const rows = await t.db.select().from(taskRequests);
  const row = rows.find((r) => r.status === 'new' && !used.has(r.id))!;
  used.add(row.id);
  return { id: row.id, taskId: row.taskId };
}
const used = new Set<string>();

const mail = () => t.mailer.messages.filter((m) => m.to === CLIENT);
const stopToken = (text: string) => /\/u#token=([0-9a-f]{64})/.exec(text)?.[1];

async function milestone(f: Fixture, name: string) {
  return (
    await f.admin.browser
      .post(`/api/v1/projects/${f.project}/milestones`)
      .send({ name, status: 'ACTIVE' })
      .expect(201)
  ).body.data.milestone.id as string;
}

describe('client status emails (0028 §2)', () => {
  it('tells the client when their request is accepted, done and delivered, once each', async () => {
    const f = await projectFixture(t);
    const v12 = await milestone(f, 'v1.2 Checkout');
    const r = await send(f, 'Add Apple Pay');

    await f.dev.browser
      .post(`/api/v1/requests/${r.id}/accept`)
      .send({ milestoneId: v12 })
      .expect(204);
    expect(mail().map((m) => m.subject)).toEqual([
      "Developer Platform: we're working on your request",
    ]);
    const accepted = mail()[0]!;
    expect(accepted.text).toContain('“Add Apple Pay”');
    expect(accepted.text).toContain("It's planned for v1.2 Checkout.");
    // Never internal details: no task keys.
    expect(accepted.text).not.toMatch(/DEV-\d/);
    expect(stopToken(accepted.text)).toBeDefined();

    await f.dev.browser.patch(`/api/v1/tasks/${r.taskId}`).send({ status: 'DONE' }).expect(200);
    await f.dev.browser.patch(`/api/v1/tasks/${r.taskId}`).send({ status: 'TODO' }).expect(200);
    await f.dev.browser.patch(`/api/v1/tasks/${r.taskId}`).send({ status: 'DONE' }).expect(200);
    await f.admin.browser
      .patch(`/api/v1/milestones/${v12}`)
      .send({ status: 'DELIVERED' })
      .expect(200);

    expect(mail().map((m) => m.subject)).toEqual([
      "Developer Platform: we're working on your request",
      'Developer Platform: your request is done',
      'Developer Platform: your request has been delivered',
    ]);
    expect(mail()[2]!.text).toContain('v1.2 Checkout');
  });

  it('sends the decline reason, and nothing for requests without an email', async () => {
    const f = await projectFixture(t);
    const r = await send(f, 'Rewrite in Rust');
    await f.dev.browser
      .post(`/api/v1/requests/${r.id}/decline`)
      .send({ reason: 'Not this quarter.' })
      .expect(204);
    expect(mail()).toHaveLength(1);
    expect(mail()[0]!.text).toContain('Their reason: Not this quarter.');

    const silent = await send(f, 'No address', null);
    await f.dev.browser
      .post(`/api/v1/requests/${silent.id}/accept`)
      .send({ milestoneId: null })
      .expect(204);
    expect(t.mailer.messages.filter((m) => m.subject.includes('working on'))).toHaveLength(0);
  });

  it('stops for good after the stop link, and the stop route never reveals tokens', async () => {
    const f = await projectFixture(t);
    const r = await send(f, 'Dark mode');
    await f.dev.browser
      .post(`/api/v1/requests/${r.id}/accept`)
      .send({ milestoneId: null })
      .expect(204);
    const token = stopToken(mail()[0]!.text)!;

    await t
      .http()
      .post('/api/v1/public/client-emails/stop')
      .send({ token: 'f'.repeat(64) })
      .expect(204);
    await t.http().post('/api/v1/public/client-emails/stop').send({ token }).expect(204);
    const [row] = await t.db.select().from(taskRequests).where(eq(taskRequests.id, r.id));
    expect(row!.emailsStoppedAt).not.toBeNull();

    await f.dev.browser.patch(`/api/v1/tasks/${r.taskId}`).send({ status: 'DONE' }).expect(200);
    expect(mail()).toHaveLength(1);
  });

  it('never fails the change when the email cannot be sent', async () => {
    const f = await projectFixture(t);
    const r = await send(f, 'Export to CSV');
    vi.spyOn(t.mailer, 'send').mockRejectedValue(new Error('Resend is down'));
    await f.dev.browser
      .post(`/api/v1/requests/${r.id}/accept`)
      .send({ milestoneId: null })
      .expect(204);
    const [row] = await t.db.select().from(taskRequests).where(eq(taskRequests.id, r.id));
    expect(row!.status).toBe('accepted');
  });

  it('never emails team proposals', async () => {
    const f = await projectFixture(t);
    await f.owner.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ internalTriage: true })
      .expect(200);
    const proposal = await f.dev.browser
      .post(`/api/v1/projects/${f.project}/proposals`)
      .send({ kind: 'bug', title: 'Login loops' })
      .expect(201);
    const [row] = await t.db
      .select()
      .from(taskRequests)
      .where(eq(taskRequests.taskId, proposal.body.data.task.id));
    await f.owner.browser
      .post(`/api/v1/requests/${row!.id}/accept`)
      .send({ milestoneId: null })
      .expect(204);
    expect(t.mailer.messages.filter((m) => m.subject.includes('your request'))).toEqual([]);
  });
});

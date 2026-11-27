import { eq, labels, notifications, taskRequests, tasks } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestsService } from '../src/requests/requests.service';
import { TurnstileVerifier } from '../src/requests/turnstile.service';
import { projectFixture } from './utils/fixtures';
import { createTestApp, TEST_PROXY_SECRET, type TestApp } from './utils/test-app';

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

/** Turns the form on and returns its token. */
async function openForm(f: Fixture): Promise<string> {
  const res = await f.owner.browser
    .put(`/api/v1/projects/${f.project}/intake`)
    .send({ enabled: true })
    .expect(200);
  return res.body.data.intake.token;
}

const submit = (token: string, body: Record<string, unknown> = {}, ip = '203.0.113.1') =>
  t
    .http()
    .post(`/api/v1/public/requests/${token}`)
    // The API trusts the client IP only from the website proxy (M8).
    .set('x-devtrack-client-ip', ip)
    .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
    .send({ kind: 'bug', title: 'Checkout button does nothing', ...body });

describe('public request form (0016)', () => {
  it('is off until a manager turns it on, and only shows the project name', async () => {
    const f = await projectFixture(t);
    const project = await f.owner.browser.get(`/api/v1/projects/${f.project}`).expect(200);
    expect(project.body.data.project.intake).toEqual({ enabled: false, token: null });
    const asDev = await f.dev.browser.get(`/api/v1/projects/${f.project}`).expect(200);
    expect(asDev.body.data.project.intake).toBeNull();

    await f.dev.browser
      .put(`/api/v1/projects/${f.project}/intake`)
      .send({ enabled: true })
      .expect(403);
    const token = await openForm(f);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const info = await t.http().get(`/api/v1/public/requests/${token}`).expect(200);
    expect(info.body.data).toEqual({ projectName: expect.any(String), uploadsEnabled: false });
    await t
      .http()
      .get(`/api/v1/public/requests/${'x'.repeat(43)}`)
      .expect(404);
  });

  it('turns a submission into a labelled Backlog task, a request and a manager notification', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const res = await submit(token, {
      description: 'Nothing happens on Safari.',
      name: 'Dana',
      email: 'dana@example.com',
    });
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ received: true, uploads: [] });

    const [task] = await t.db.select().from(tasks).where(eq(tasks.projectId, f.project));
    expect(task).toMatchObject({
      title: 'Checkout button does nothing',
      description: 'Nothing happens on Safari.',
      status: 'BACKLOG',
      reporterId: null,
    });
    const listed = await f.dev.browser.get(`/api/v1/projects/${f.project}/requests`).expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({
      kind: 'bug',
      status: 'new',
      reporterName: 'Dana',
      reporterEmail: 'dana@example.com',
      task: { id: task!.id, title: 'Checkout button does nothing', status: 'BACKLOG' },
    });
    const view = await f.dev.browser.get(`/api/v1/tasks/${task!.id}`).expect(200);
    expect(view.body.data.task.labels.map((l: { name: string }) => l.name)).toEqual(['Bug']);

    // A second bug reuses the label.
    await submit(token, { title: 'Another one' }, '203.0.113.2').expect(202);
    expect(await t.db.select().from(labels).where(eq(labels.name, 'Bug'))).toHaveLength(1);

    // Owner and admin are notified, not the member; the title never carries contact details.
    const notes = (await t.db.select().from(notifications)).filter(
      (n) => n.type === 'REQUEST_SUBMITTED',
    );
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([f.owner.id, f.admin.id]));
    expect(notes.every((n) => !n.title.includes('dana'))).toBe(true);

    const project = await f.dev.browser.get(`/api/v1/projects/${f.project}`).expect(200);
    expect(project.body.data.project.newRequestCount).toBe(2);
  });

  it('silently drops honeypot submissions and rejects a failed Turnstile check', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    await submit(token, { website: 'http://spam.example' }).expect(202);
    expect(await t.db.select().from(taskRequests)).toEqual([]);

    vi.spyOn(t.app.get(TurnstileVerifier), 'verify').mockResolvedValue(false);
    const res = await submit(token, {}, '203.0.113.9');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('turnstileToken');
    expect(await t.db.select().from(taskRequests)).toEqual([]);
  });

  it('validates input and rate-limits by IP', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    await submit(token, { title: 'no' }).expect(400);
    await submit(token, { email: 'not-an-email' }).expect(400);
    for (let i = 0; i < 5; i++)
      await submit(token, { title: `Bug ${i}` }, '198.51.100.7').expect(202);
    const limited = await submit(token, { title: 'Bug 6' }, '198.51.100.7');
    expect(limited.status).toBe(429);
    // Another address is still welcome.
    await submit(token, { title: 'Bug 7' }, '198.51.100.8').expect(202);
  });

  it('stops working when turned off, when the link is replaced, or when the project is archived', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const rotated = await f.owner.browser
      .post(`/api/v1/projects/${f.project}/intake/rotate`)
      .expect(201);
    const fresh: string = rotated.body.data.intake.token;
    expect(fresh).not.toBe(token);
    await submit(token).expect(404);
    await submit(fresh).expect(202);

    await f.owner.browser.put(`/api/v1/projects/${f.project}/intake`).send({ enabled: false });
    await submit(fresh, {}, '203.0.113.3').expect(404);
    await t.http().get(`/api/v1/public/requests/${fresh}`).expect(404);

    await f.owner.browser.put(`/api/v1/projects/${f.project}/intake`).send({ enabled: true });
    await f.owner.browser.delete(`/api/v1/projects/${f.project}`).expect(204);
    await submit(fresh, {}, '203.0.113.4').expect(404);
  });
});

describe('triage (0016)', () => {
  it('lets task editors accept or decline once, and declining deletes the task', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    await submit(token, { title: 'Keep me' }).expect(202);
    await submit(token, { title: 'Spam-ish', kind: 'request' }, '203.0.113.5').expect(202);
    const list = await f.dev.browser.get(`/api/v1/projects/${f.project}/requests`).expect(200);
    const keep = list.body.data.find(
      (r: { task: { title: string } }) => r.task.title === 'Keep me',
    );
    const drop = list.body.data.find(
      (r: { task: { title: string } }) => r.task.title === 'Spam-ish',
    );

    // Outsiders can't see or triage.
    await f.bystander.browser.get(`/api/v1/projects/${f.project}/requests`).expect(404);
    await f.bystander.browser
      .post(`/api/v1/requests/${keep.id}/accept`)
      .send({ milestoneId: null })
      .expect(404);

    await f.dev.browser
      .post(`/api/v1/requests/${keep.id}/accept`)
      .send({ milestoneId: null })
      .expect(204);
    await f.dev.browser.post(`/api/v1/requests/${keep.id}/decline`).expect(409);
    await f.dev.browser.post(`/api/v1/requests/${drop.id}/decline`).expect(204);

    const accepted = await f.dev.browser
      .get(`/api/v1/projects/${f.project}/requests?status=accepted`)
      .expect(200);
    expect(accepted.body.data).toHaveLength(1);
    expect(accepted.body.data[0].triagedBy.id).toBe(f.dev.id);
    const declined = await f.dev.browser
      .get(`/api/v1/projects/${f.project}/requests?status=declined`)
      .expect(200);
    expect(declined.body.data[0].task).toBeNull();
    await f.dev.browser.get(`/api/v1/tasks/${drop.task.id}`).expect(404);
    expect(
      (await f.dev.browser.get(`/api/v1/projects/${f.project}/requests`).expect(200)).body.data,
    ).toEqual([]);
  });

  it('deletes reporter contact details 90 days after the task is done or declined', async () => {
    const f = await projectFixture(t);
    const token = await openForm(f);
    const contact = { name: 'Dana', email: 'dana@example.com' };
    await submit(token, { title: 'Done one', ...contact }).expect(202);
    await submit(token, { title: 'Declined one', ...contact }, '203.0.113.6').expect(202);
    await submit(token, { title: 'Still open', ...contact }, '203.0.113.7').expect(202);
    const list = (await f.dev.browser.get(`/api/v1/projects/${f.project}/requests`)).body.data;
    const byTitle = (title: string) =>
      list.find((r: { task: { title: string } }) => r.task.title === title);

    await f.dev.browser
      .patch(`/api/v1/tasks/${byTitle('Done one').task.id}/status`)
      .send({ status: 'DONE' })
      .expect(200);
    await f.dev.browser.post(`/api/v1/requests/${byTitle('Declined one').id}/decline`).expect(204);

    const service = t.app.get(RequestsService);
    expect(await service.deleteOldContacts(new Date())).toBe(0);
    const later = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);
    expect(await service.deleteOldContacts(later)).toBe(2);
    expect(await service.deleteOldContacts(later)).toBe(0);

    const rows = await t.db.select().from(taskRequests);
    const open = rows.find((r) => r.reporterName === 'Dana');
    expect(rows.filter((r) => r.contactDeletedAt)).toHaveLength(2);
    expect(open?.reporterEmail).toBe('dana@example.com');
  });
});

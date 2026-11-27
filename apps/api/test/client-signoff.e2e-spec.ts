import { and, eq, notifications } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, TEST_PROXY_SECRET, type TestApp } from './utils/test-app';

/** Decision record 0028 §3–§4: the client's sign-off link and Approve. */
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

async function inReview(f: Fixture) {
  const id = (
    await f.admin.browser
      .post(`/api/v1/projects/${f.project}/milestones`)
      .send({ name: 'v1.2 Checkout', description: 'Apple Pay and receipts', status: 'ACTIVE' })
      .expect(201)
  ).body.data.milestone.id as string;
  await f.admin.browser
    .post(`/api/v1/milestones/${id}/criteria`)
    .send({ text: 'Customers can pay with Apple Pay' })
    .expect(201);
  await stage(f, id, 'CLIENT_REVIEW');
  return id;
}
const stage = (f: Fixture, id: string, status: string) =>
  f.admin.browser.patch(`/api/v1/milestones/${id}`).send({ status }).expect(200);
const link = async (f: Fixture, id: string, replace = false) =>
  (
    await f.admin.browser
      .post(`/api/v1/milestones/${id}/signoff-link`)
      .send({ replace })
      .expect(200)
  ).body.data.url as string;
const tokenOf = (url: string) => url.split('/s/')[1]!;

let ip = 0;
const approve = (token: string, body: Record<string, unknown> = {}) =>
  t
    .http()
    .post(`/api/v1/public/signoff/${token}/approve`)
    .set('x-devtrack-client-ip', `203.0.113.${(ip++ % 200) + 1}`)
    .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
    .send(body);

describe('sign-off link (0028 §3)', () => {
  it('is for leads and admins while the milestone is in Client review, and shows only what was promised', async () => {
    const f = await projectFixture(t);
    const id = await inReview(f);
    expect(
      (await f.dev.browser.post(`/api/v1/milestones/${id}/signoff-link`).send({})).status,
    ).toBe(403);

    const url = await link(f, id);
    expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    // Asking again returns the same link.
    expect(await link(f, id)).toBe(url);

    const page = await t
      .http()
      .get(`/api/v1/public/signoff/${tokenOf(url)}`)
      .expect(200);
    expect(page.body.data).toEqual({
      projectName: 'Developer Platform',
      milestone: {
        name: 'v1.2 Checkout',
        description: 'Apple Pay and receipts',
        dueDate: null,
        criteria: [{ text: 'Customers can pay with Apple Pay', done: false }],
        releases: [],
        approvedAt: null,
      },
    });
  });

  it('stops working outside Client review and when replaced', async () => {
    const f = await projectFixture(t);
    const id = await inReview(f);
    const first = tokenOf(await link(f, id));

    await stage(f, id, 'ACTIVE');
    await t.http().get(`/api/v1/public/signoff/${first}`).expect(404);
    expect(
      (await f.admin.browser.post(`/api/v1/milestones/${id}/signoff-link`).send({})).status,
    ).toBe(409);
    // Back in review: the same link works again.
    await stage(f, id, 'CLIENT_REVIEW');
    await t.http().get(`/api/v1/public/signoff/${first}`).expect(200);

    const second = tokenOf(await link(f, id, true));
    expect(second).not.toBe(first);
    await t.http().get(`/api/v1/public/signoff/${first}`).expect(404);
    await t.http().get(`/api/v1/public/signoff/${second}`).expect(200);
    await t.http().get('/api/v1/public/signoff/not-a-token').expect(404);
  });
});

describe('Approve (0028 §4)', () => {
  it('records the approval and tells the people responsible, without moving the stage', async () => {
    const f = await projectFixture(t);
    const id = await inReview(f);
    const token = tokenOf(await link(f, id));

    await approve(token, { name: 'Dana from Acme', note: 'Looks great.' }).expect(202);
    const milestone = (await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`)).body
      .data[0];
    expect(milestone).toMatchObject({
      status: 'CLIENT_REVIEW',
      clientApproval: { name: 'Dana from Acme', note: 'Looks great.' },
    });

    const told = await t.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, f.owner.id),
          eq(notifications.type, 'MILESTONE_CLIENT_APPROVED'),
        ),
      );
    expect(told.map((n) => [n.title, n.body])).toEqual([
      ['Dana from Acme approved "v1.2 Checkout" in DEV', 'Looks great.'],
    ]);

    // Approving again updates it and tells them again.
    await approve(token, { note: 'Also tested on mobile.' }).expect(202);
    const again = (await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`)).body
      .data[0];
    expect(again.clientApproval).toMatchObject({ name: null, note: 'Also tested on mobile.' });
    const all = await t.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, f.owner.id),
          eq(notifications.type, 'MILESTONE_CLIENT_APPROVED'),
        ),
      );
    expect(all).toHaveLength(2);

    const feed = await f.dev.browser.get(`/api/v1/projects/${f.project}/activity?limit=50`);
    const approvals = (
      feed.body.data as { action: string; metadata: Record<string, unknown> }[]
    ).filter((e) => e.action === 'milestone.client_approved');
    expect(approvals).toHaveLength(2);
    // The client's note never goes into activity.
    expect(JSON.stringify(approvals)).not.toContain('Looks great.');
  });

  it('stores nothing for the honeypot, and refuses links that are no longer active', async () => {
    const f = await projectFixture(t);
    const id = await inReview(f);
    const token = tokenOf(await link(f, id));
    await approve(token, { website: 'http://spam.example' }).expect(202);
    const milestone = (await f.dev.browser.get(`/api/v1/projects/${f.project}/milestones`)).body
      .data[0];
    expect(milestone.clientApproval).toBeNull();

    await stage(f, id, 'DELIVERED');
    await approve(token).expect(404);
  });
});

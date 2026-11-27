import { activityLogs, and, eq, notifications, taskRequests } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, TEST_PROXY_SECRET, type TestApp } from './utils/test-app';

/** Decision record 0024 §3: accepting files a request into a milestone, or leaves it unscheduled. */
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

let ip = 0;
const seen = new Set<string>();
/** A form request in Triage; returns the request and its task ids. */
async function newRequest(f: Fixture, title = 'Checkout fails') {
  const form = await f.owner.browser
    .put(`/api/v1/projects/${f.project}/intake`)
    .send({ enabled: true })
    .expect(200);
  await t
    .http()
    .post(`/api/v1/public/requests/${form.body.data.intake.token}`)
    .set('x-devtrack-client-ip', `203.0.113.${(ip++ % 200) + 1}`)
    .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
    .send({ kind: 'bug', title })
    .expect(202);
  const rows = await t.db.select().from(taskRequests).where(eq(taskRequests.status, 'new'));
  const request = rows.find((r) => !seen.has(r.id))!;
  seen.add(request.id);
  return { id: request.id, taskId: request.taskId };
}
async function milestone(f: Fixture, name: string, projectId = f.project) {
  return (
    await f.owner.browser
      .post(`/api/v1/projects/${projectId}/milestones`)
      .send({ name })
      .expect(201)
  ).body.data.milestone.id as string;
}

const accept = (f: Fixture, requestId: string, body: Record<string, unknown>) =>
  f.owner.browser.post(`/api/v1/requests/${requestId}/accept`).send(body);

const taskOf = async (f: Fixture, taskId: string) =>
  (await f.owner.browser.get(`/api/v1/tasks/${taskId}`).expect(200)).body.data.task as {
    status: string;
    milestoneId: string | null;
    assignees: { id: string }[];
  };

describe('accepting a request (0024 §3)', () => {
  it('into an open milestone: files it there and moves it to To do', async () => {
    const f = await projectFixture(t);
    const v12 = await milestone(f, 'v1.2 Checkout');
    const r = await newRequest(f);

    await accept(f, r.id, { milestoneId: v12 }).expect(204);
    expect(await taskOf(f, r.taskId)).toMatchObject({ status: 'TODO', milestoneId: v12 });

    const updates = await t.db
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.taskId, r.taskId), eq(activityLogs.action, 'updated')));
    expect(updates.map((u) => (u.metadata as { changes: unknown }).changes)).toContainEqual({
      milestone: { from: null, to: 'v1.2 Checkout' },
    });
  });

  it('unscheduled: accepted, but stays in Backlog with no milestone', async () => {
    const f = await projectFixture(t);
    const r = await newRequest(f);
    await accept(f, r.id, { milestoneId: null }).expect(204);
    expect(await taskOf(f, r.taskId)).toMatchObject({ status: 'BACKLOG', milestoneId: null });
    const accepted = await f.owner.browser
      .get(`/api/v1/projects/${f.project}/requests?status=accepted`)
      .expect(200);
    expect(accepted.body.data).toHaveLength(1);
  });

  it('needs an explicit, open milestone from this project', async () => {
    const f = await projectFixture(t);
    const r = await newRequest(f);

    const missing = await accept(f, r.id, {});
    expect(missing.status).toBe(400);

    const shipped = await milestone(f, 'v1.0');
    await f.owner.browser
      .patch(`/api/v1/milestones/${shipped}`)
      .send({ status: 'COMPLETED' })
      .expect(200);
    expect((await accept(f, r.id, { milestoneId: shipped })).status).toBe(400);

    const other = (
      await f.owner.browser
        .post(`/api/v1/workspaces/${f.ws}/projects`)
        .send({ name: 'Other', key: 'OTH' })
        .expect(201)
    ).body.data.project.id as string;
    const elsewhere = await milestone(f, 'Elsewhere', other);
    const refused = await accept(f, r.id, { milestoneId: elsewhere });
    expect(refused.status).toBe(400);

    // Nothing was triaged by the refused attempts.
    const still = await f.owner.browser.get(`/api/v1/projects/${f.project}/requests`).expect(200);
    expect(still.body.data).toHaveLength(1);
  });

  it('hands the task out to project members, who hear about it', async () => {
    const f = await projectFixture(t);
    const r = await newRequest(f);

    const outsider = await accept(f, r.id, { milestoneId: null, assigneeIds: [f.bystander.id] });
    expect(outsider.status).toBe(400);
    expect(outsider.body.error.code).toBe('NOT_PROJECT_MEMBER');

    await accept(f, r.id, { milestoneId: null, assigneeIds: [f.dev.id] }).expect(204);
    expect((await taskOf(f, r.taskId)).assignees.map((a) => a.id)).toEqual([f.dev.id]);
    const told = await t.db.select().from(notifications).where(eq(notifications.userId, f.dev.id));
    expect(told.map((n) => n.type)).toContain('TASK_ASSIGNED');
  });

  it('unscheduled clears a milestone someone set on the task before triage', async () => {
    const f = await projectFixture(t);
    const v12 = await milestone(f, 'v1.2');
    const r = await newRequest(f);
    await f.owner.browser.patch(`/api/v1/tasks/${r.taskId}`).send({ milestoneId: v12 }).expect(200);
    await accept(f, r.id, { milestoneId: null }).expect(204);
    expect(await taskOf(f, r.taskId)).toMatchObject({ status: 'BACKLOG', milestoneId: null });
  });
});

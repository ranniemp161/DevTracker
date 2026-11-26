import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TEST_PROXY_SECRET, verifiedUser, type TestApp } from './utils/test-app';

/** Decision record 0023 §3: internal triage and proposals. */
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

/** Owner; `lead` and `dev` are Members on project DEV. Nobody is a lead yet. */
async function setup() {
  const [owner, lead, dev] = await Promise.all(
    ['owner', 'lead', 'dev'].map((u) => verifiedUser(t, u)),
  );
  const ws = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body.data
    .workspace.id as string;
  for (const u of [lead!, dev!]) {
    await owner!.browser
      .post(`/api/v1/workspaces/${ws}/invitations`)
      .send({ email: u.email, role: 'MEMBER' })
      .expect(201);
    const token = t.mailer.lastToken(u.email, 'invited you');
    await u.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
  }
  const project = (
    await owner!.browser
      .post(`/api/v1/workspaces/${ws}/projects`)
      .send({ name: 'Developer Platform', key: 'DEV' })
      .expect(201)
  ).body.data.project.id as string;
  for (const u of [lead!, dev!]) {
    await owner!.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: u.id })
      .expect(201);
  }
  return { owner: owner!, lead: lead!, dev: dev!, project };
}

const makeLead = (owner: U, project: string, user: U) =>
  owner.browser
    .patch(`/api/v1/projects/${project}/members/${user.id}`)
    .send({ role: 'lead' })
    .expect(200);

const setInternalTriage = (u: U, project: string, on: boolean) =>
  u.browser.patch(`/api/v1/projects/${project}`).send({ internalTriage: on }).expect(200);

const createTask = (u: U, project: string, title = 'Direct task') =>
  u.browser.post(`/api/v1/projects/${project}/tasks`).send({ title });

const propose = (u: U, project: string, body: Record<string, unknown> = {}) =>
  u.browser
    .post(`/api/v1/projects/${project}/proposals`)
    .send({ kind: 'bug', title: 'Login loops forever', ...body });

const mustPropose = async (u: U, project: string) =>
  (await u.browser.get(`/api/v1/projects/${project}`).expect(200)).body.data.project
    .viewerMustPropose as boolean;

describe('the internal triage gate', () => {
  it('only applies with the setting on and a lead appointed', async () => {
    const { owner, lead, dev, project } = await setup();

    // Off: members create tasks; there's nothing to propose to.
    await createTask(dev, project).expect(201);
    expect((await propose(dev, project)).body.error.code).toBe('INTERNAL_TRIAGE_OFF');

    // On, but no lead yet: still off in effect.
    await setInternalTriage(owner, project, true);
    await createTask(dev, project).expect(201);
    expect((await propose(dev, project)).status).toBe(409);
    expect(await mustPropose(dev, project)).toBe(false);

    // On with a lead: members must propose; the lead and the owner create directly.
    await makeLead(owner, project, lead);
    const refused = await createTask(dev, project);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('PROPOSAL_REQUIRED');
    expect(await mustPropose(dev, project)).toBe(true);
    expect(await mustPropose(lead, project)).toBe(false);
    await createTask(lead, project).expect(201);
    await createTask(owner, project).expect(201);
    await propose(dev, project).expect(201);
  });
});

/** Internal triage on, `lead` appointed. */
async function gated() {
  const f = await setup();
  await setInternalTriage(f.owner, f.project, true);
  await makeLead(f.owner, f.project, f.lead);
  return f;
}

const requestsFor = async (u: U, project: string, query = '') =>
  (await u.browser.get(`/api/v1/projects/${project}/requests${query}`).expect(200)).body.data as {
    id: string;
    source: string;
    reporter: { id: string; username: string } | null;
    reporterName: string | null;
    task: { id: string; title: string } | null;
  }[];

const toldAbout = async (u: U) =>
  (
    (await u.browser.get('/api/v1/notifications').expect(200)).body.data as {
      type: string;
      title: string;
    }[]
  )
    .filter((n) => n.type === 'REQUEST_SUBMITTED')
    .map((n) => n.title);

describe('a proposal', () => {
  it('becomes a labelled Backlog task in Triage that the lead hears about and accepts', async () => {
    const { lead, dev, project } = await gated();

    const created = await propose(dev, project, { description: 'Steps: sign in twice.' }).expect(
      201,
    );
    const taskId = created.body.data.task.id as string;
    const task = (await dev.browser.get(`/api/v1/tasks/${taskId}`).expect(200)).body.data.task;
    expect(task).toMatchObject({
      title: 'Login loops forever',
      description: 'Steps: sign in twice.',
      status: 'BACKLOG',
      reporter: { id: dev.id },
      assignees: [],
    });
    expect(task.labels.map((l: { name: string }) => l.name)).toEqual(['Bug']);

    const [request] = await requestsFor(lead, project);
    expect(request).toMatchObject({
      source: 'internal',
      reporter: { id: dev.id, username: 'dev' },
      reporterName: null,
      task: { id: taskId },
    });
    expect(await toldAbout(lead)).toEqual(['New bug report in DEV: Login loops forever']);
    expect(await toldAbout(dev)).toEqual([]);

    await lead.browser.post(`/api/v1/requests/${request!.id}/accept`).expect(204);
    expect(
      (await dev.browser.get(`/api/v1/tasks/${taskId}`).expect(200)).body.data.task.status,
    ).toBe('TODO');
  });
});

describe('Triage with both sources', () => {
  it('filters by source and keeps form requests as they were', async () => {
    const { owner, lead, dev, project } = await gated();
    await propose(dev, project, { title: 'From the team', kind: 'request' }).expect(201);
    const form = await owner.browser
      .put(`/api/v1/projects/${project}/intake`)
      .send({ enabled: true })
      .expect(200);
    await t
      .http()
      .post(`/api/v1/public/requests/${form.body.data.intake.token}`)
      .set('x-devtrack-client-ip', '203.0.113.1')
      .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
      .send({ kind: 'bug', title: 'From a client', name: 'Ana', email: 'ana@example.com' })
      .expect(202);

    const titles = async (query: string) =>
      (await requestsFor(lead, project, query)).map((r) => r.task?.title).sort();
    expect(await titles('')).toEqual(['From a client', 'From the team']);
    expect(await titles('?source=internal')).toEqual(['From the team']);
    expect(await titles('?source=form')).toEqual(['From a client']);

    const [client] = await requestsFor(lead, project, '?source=form');
    expect(client).toMatchObject({ source: 'form', reporter: null, reporterName: 'Ana' });
  });
});

describe('turning internal triage off', () => {
  it('keeps open proposals in Triage and lets members create tasks again', async () => {
    const { lead, dev, project } = await gated();
    await propose(dev, project).expect(201);

    await setInternalTriage(lead, project, false);
    expect((await requestsFor(lead, project)).map((r) => r.task?.title)).toEqual([
      'Login loops forever',
    ]);
    await createTask(dev, project).expect(201);
    expect(await mustPropose(dev, project)).toBe(false);
    expect((await propose(dev, project)).status).toBe(409);
  });
});

const notes = async (u: U, type: string) =>
  (
    (await u.browser.get('/api/v1/notifications').expect(200)).body.data as {
      type: string;
      title: string;
      body: string | null;
      link: string | null;
    }[]
  ).filter((n) => n.type === type);

const requestIdFor = async (lead: U, project: string, title: string) =>
  (await requestsFor(lead, project)).find((r) => r.task?.title === title)!.id;

describe('telling the proposer (0023 §5)', () => {
  it('sends the outcome to the proposer, never to the lead or for form requests', async () => {
    const { owner, lead, dev, project } = await gated();
    const kept = (await propose(dev, project, { title: 'Keep sessions alive' }).expect(201)).body
      .data.task.id as string;
    await propose(dev, project, { title: 'Rewrite in Rust' }).expect(201);

    await lead.browser
      .post(`/api/v1/requests/${await requestIdFor(lead, project, 'Keep sessions alive')}/accept`)
      .expect(204);
    await lead.browser
      .post(`/api/v1/requests/${await requestIdFor(lead, project, 'Rewrite in Rust')}/decline`)
      .send({ reason: 'Not this quarter.' })
      .expect(204);

    const outcomes = await notes(dev, 'REQUEST_TRIAGED');
    expect(outcomes.map(({ title, body, link }) => ({ title, body, link })).reverse()).toEqual([
      {
        title: 'Accepted: Keep sessions alive',
        body: null,
        link: `/projects/${project}/tasks/${kept}`,
      },
      {
        title: 'Declined: Rewrite in Rust',
        body: 'Not this quarter.',
        link: `/projects/${project}/triage`,
      },
    ]);
    expect(await notes(lead, 'REQUEST_TRIAGED')).toEqual([]);

    // A form request has no account to tell.
    const form = await owner.browser
      .put(`/api/v1/projects/${project}/intake`)
      .send({ enabled: true })
      .expect(200);
    await t
      .http()
      .post(`/api/v1/public/requests/${form.body.data.intake.token}`)
      .set('x-devtrack-client-ip', '203.0.113.1')
      .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
      .send({ kind: 'bug', title: 'From a client' })
      .expect(202);
    await lead.browser
      .post(`/api/v1/requests/${await requestIdFor(lead, project, 'From a client')}/accept`)
      .expect(204);
    for (const u of [owner, lead, dev]) {
      expect((await notes(u, 'REQUEST_TRIAGED')).length).toBe(u === dev ? 2 : 0);
    }
  });
});

describe('decline reason (0023 §4)', () => {
  it('is optional, at most 500 characters, and shown on declined items', async () => {
    const { lead, dev, project } = await gated();
    await propose(dev, project, { title: 'First idea' }).expect(201);
    await propose(dev, project, { title: 'Second idea' }).expect(201);
    const first = await requestIdFor(lead, project, 'First idea');
    const second = await requestIdFor(lead, project, 'Second idea');

    const tooLong = await lead.browser
      .post(`/api/v1/requests/${first}/decline`)
      .send({ reason: 'x'.repeat(501) });
    expect(tooLong.status).toBe(400);

    await lead.browser
      .post(`/api/v1/requests/${first}/decline`)
      .send({ reason: '  Duplicate of DEV-1.  ' })
      .expect(204);
    await lead.browser.post(`/api/v1/requests/${second}/decline`).expect(204);

    const declined = await lead.browser
      .get(`/api/v1/projects/${project}/requests?status=declined`)
      .expect(200);
    expect(
      Object.fromEntries(
        (declined.body.data as { id: string; declineReason: string | null }[]).map((r) => [
          r.id,
          r.declineReason,
        ]),
      ),
    ).toEqual({ [first]: 'Duplicate of DEV-1.', [second]: null });
  });
});

describe('my proposals (0023 §5)', () => {
  it("shows members their own proposals, declined ones included, and nobody else's", async () => {
    const { owner, lead, dev, project } = await gated();
    // A second member on DEV.
    const other = await verifiedUser(t, 'other');
    const ws = (await owner.browser.get(`/api/v1/projects/${project}`).expect(200)).body.data
      .project.workspaceId as string;
    await owner.browser
      .post(`/api/v1/workspaces/${ws}/invitations`)
      .send({ email: other.email, role: 'MEMBER' })
      .expect(201);
    await other.browser
      .post('/api/v1/invitations/accept')
      .send({ token: t.mailer.lastToken(other.email, 'invited you') })
      .expect(200);
    await owner.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: other.id })
      .expect(201);

    await propose(dev, project, { title: 'Dark mode', kind: 'request' }).expect(201);
    await propose(dev, project, { title: 'Blink tag' }).expect(201);
    await propose(other, project, { title: 'Not yours' }).expect(201);
    await lead.browser
      .post(`/api/v1/requests/${await requestIdFor(lead, project, 'Blink tag')}/decline`)
      .send({ reason: 'No.' })
      .expect(204);

    const mine = (u: U) =>
      u.browser.get(`/api/v1/projects/${project}/proposals?mine=true`).expect(200);
    const devs = (await mine(dev)).body.data as {
      status: string;
      kind: string;
      task: { title: string } | null;
      declineReason: string | null;
    }[];
    expect(
      devs.map((r) => ({
        status: r.status,
        title: r.task?.title ?? null,
        reason: r.declineReason,
      })),
    ).toEqual([
      { status: 'declined', title: null, reason: 'No.' },
      { status: 'new', title: 'Dark mode', reason: null },
    ]);
    expect(((await mine(other)).body.data as unknown[]).length).toBe(1);

    // The full list stays with the people who triage.
    expect((await other.browser.get(`/api/v1/projects/${project}/requests`)).status).toBe(403);
  });
});

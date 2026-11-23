import {
  activityLogs,
  and,
  eq,
  githubPullRequests,
  outboxEvents,
  taskRequests,
} from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TestUser } from './utils/fixtures';
import { commit, deliver, githubFixture, pullRequestEvent, pushEvent } from './utils/github';
import { createTestApp, TEST_PROXY_SECRET, type TestApp } from './utils/test-app';

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

type Fixture = Awaited<ReturnType<typeof githubFixture>>;

/** A new task in the DEV project (DEV-1 first), TODO unless a status is given. */
async function newTask(f: { owner: TestUser; project: string }, status?: string) {
  const res = await f.owner.browser
    .post(`/api/v1/projects/${f.project}/tasks`)
    .send({ title: 'Login is broken', ...(status ? { status } : {}) })
    .expect(201);
  return res.body.data.task as { id: string; key: string };
}

const statusOf = async (f: Fixture, id: string): Promise<string> =>
  (await f.owner.browser.get(`/api/v1/tasks/${id}`).expect(200)).body.data.task.status;

const setStatus = (f: Fixture, id: string, status: string) =>
  f.owner.browser.patch(`/api/v1/tasks/${id}/status`).send({ status }).expect(200);

/** Status changes recorded for a task, oldest first. */
const statusChanges = async (taskId: string) =>
  (
    await t.db
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.taskId, taskId), eq(activityLogs.action, 'updated')))
      .orderBy(activityLogs.createdAt, activityLogs.id)
  ).map((r) => ({
    actorId: r.actorId,
    status: (r.metadata.changes as { status?: unknown }).status,
    automation: r.metadata.automation,
  }));

describe('pull requests move linked tasks to In review (0021)', () => {
  it('moves on open, records it like a manual move, with no actor', async () => {
    const f = await githubFixture(t);
    const task = await newTask(f); // DEV-1; the PR branch is feature/dev-1-login
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);

    expect(await statusOf(f, task.id)).toBe('IN_REVIEW');
    expect(await statusChanges(task.id)).toEqual([
      {
        actorId: null,
        status: { from: 'TODO', to: 'IN_REVIEW' },
        automation: {
          trigger: 'pull_request',
          repository: 'acme-org/api',
          prNumber: 12,
          url: 'https://github.com/acme-org/api/pull/12',
        },
      },
    ]);
    const live = await t.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'task.updated'));
    expect(live.map((e) => (e.payload as { payload: unknown }).payload)).toContainEqual({
      taskId: task.id,
      changes: { status: { from: 'TODO', to: 'IN_REVIEW' } },
    });

    // Time in status sees the automatic move.
    const time = await f.owner.browser.get(`/api/v1/tasks/${task.id}/time-in-status`).expect(200);
    expect(JSON.stringify(time.body.data)).toContain('IN_REVIEW');
  });

  it('waits for a draft to be marked ready, and counts a reopen after a manual move back', async () => {
    const f = await githubFixture(t);
    const task = await newTask(f);
    await deliver(t, 'pull_request', pullRequestEvent('opened', { draft: true })).expect(202);
    expect(await statusOf(f, task.id)).toBe('TODO');

    await deliver(t, 'pull_request', pullRequestEvent('ready_for_review', { draft: false }));
    expect(await statusOf(f, task.id)).toBe('IN_REVIEW');

    // Review failed: a person moves it back. Closing does nothing; reopening moves it again.
    await setStatus(f, task.id, 'IN_PROGRESS');
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('closed', { state: 'closed', updated_at: '2026-11-06T11:00:00Z' }),
    ).expect(202);
    expect(await statusOf(f, task.id)).toBe('IN_PROGRESS');
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('reopened', { updated_at: '2026-11-06T12:00:00Z' }),
    ).expect(202);
    expect(await statusOf(f, task.id)).toBe('IN_REVIEW');
  });

  it('never moves Blocked, Done or deleted tasks, and never sets Done on merge', async () => {
    const f = await githubFixture(t);
    const blocked = await newTask(f, 'BLOCKED'); // DEV-1
    const done = await newTask(f, 'DONE'); // DEV-2
    const deleted = await newTask(f); // DEV-3
    const open = await newTask(f); // DEV-4
    await f.owner.browser.delete(`/api/v1/tasks/${deleted.id}`).expect(204);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('opened', { head: { ref: 'dev-1-dev-2-dev-3-dev-4' } }),
    ).expect(202);

    expect(await statusOf(f, blocked.id)).toBe('BLOCKED');
    expect(await statusOf(f, done.id)).toBe('DONE');
    expect(await statusOf(f, open.id)).toBe('IN_REVIEW');
    expect(await statusChanges(deleted.id)).toEqual([]);

    await deliver(
      t,
      'pull_request',
      pullRequestEvent('closed', {
        state: 'closed',
        merged_at: '2026-11-06T13:00:00Z',
        updated_at: '2026-11-06T13:00:00Z',
        head: { ref: 'dev-1-dev-2-dev-3-dev-4' },
      }),
    ).expect(202);
    expect(await statusOf(f, open.id)).toBe('IN_REVIEW');
  });

  it('does not move a task when an open PR is linked by hand', async () => {
    const f = await githubFixture(t);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('opened', { head: { ref: 'no-key-here' }, title: 'Tidy up' }),
    ).expect(202);
    const task = await newTask(f);
    const [row] = await t.db.select().from(githubPullRequests);
    await f.owner.browser
      .post(`/api/v1/tasks/${task.id}/pull-requests`)
      .send({ pullRequestId: row!.id })
      .expect(201);
    expect(await statusOf(f, task.id)).toBe('TODO');
  });
});

describe('commits move tasks to In progress (0021)', () => {
  it('matches keys in commit messages and branch names, on any branch, once', async () => {
    const f = await githubFixture(t);
    const fromMessage = await newTask(f); // DEV-1
    const fromBranch = await newTask(f, 'BACKLOG'); // DEV-2
    const untouched = await newTask(f); // DEV-3

    const onMain = pushEvent([commit(1, 'DEV-1: fix the login form')]);
    await deliver(t, 'push', onMain, { deliveryId: 'push-1' }).expect(202);
    await deliver(t, 'push', pushEvent([commit(2, 'wip')], 'refs/heads/feature/dev-2-signup'));

    expect(await statusOf(f, fromMessage.id)).toBe('IN_PROGRESS');
    expect(await statusOf(f, fromBranch.id)).toBe('IN_PROGRESS');
    expect(await statusOf(f, untouched.id)).toBe('TODO');
    expect((await statusChanges(fromMessage.id))[0]).toMatchObject({
      actorId: null,
      status: { from: 'TODO', to: 'IN_PROGRESS' },
      automation: { trigger: 'commit', repository: 'acme-org/api', sha: commit(1).id },
    });

    // A person moves it back; the same commit pushed again (or a retried delivery) moves nothing.
    await setStatus(f, fromMessage.id, 'TODO');
    await deliver(t, 'push', onMain, { deliveryId: 'push-1' }).expect(202);
    await deliver(t, 'push', pushEvent([commit(1, 'DEV-1: fix the login form')], 'refs/heads/x'));
    expect(await statusOf(f, fromMessage.id)).toBe('TODO');

    // A new commit does.
    await deliver(t, 'push', pushEvent([commit(3, 'More work on dev-1')])).expect(202);
    expect(await statusOf(f, fromMessage.id)).toBe('IN_PROGRESS');
  });

  it('never moves a task backwards, and ignores keys of other projects', async () => {
    const f = await githubFixture(t);
    const inReview = await newTask(f, 'IN_REVIEW'); // DEV-1
    const todo = await newTask(f); // DEV-2
    await deliver(t, 'push', pushEvent([commit(1, 'DEV-1 and OPS-2 tweaks')])).expect(202);
    expect(await statusOf(f, inReview.id)).toBe('IN_REVIEW');
    expect(await statusOf(f, todo.id)).toBe('TODO');
  });
});

describe('triage moves accepted requests to To do (0021)', () => {
  async function requestTask(f: Fixture, title: string) {
    const form = await f.owner.browser
      .put(`/api/v1/projects/${f.project}/intake`)
      .send({ enabled: true })
      .expect(200);
    await t
      .http()
      .post(`/api/v1/public/requests/${form.body.data.intake.token}`)
      .set('x-devtrack-client-ip', `203.0.113.${Math.floor(Math.random() * 200) + 1}`)
      .set('x-devtrack-proxy-secret', TEST_PROXY_SECRET)
      .send({ kind: 'bug', title })
      .expect(202);
    const [request] = await t.db.select().from(taskRequests).where(eq(taskRequests.status, 'new'));
    return request!;
  }

  it('moves a Backlog task to To do, but leaves a task the team already moved', async () => {
    const f = await githubFixture(t);
    const first = await requestTask(f, 'Checkout fails');
    await f.dev.browser.post(`/api/v1/requests/${first.id}/accept`).expect(204);
    expect(await statusOf(f, first.taskId)).toBe('TODO');
    expect((await statusChanges(first.taskId))[0]).toMatchObject({
      actorId: null,
      status: { from: 'BACKLOG', to: 'TODO' },
      automation: { trigger: 'request' },
    });

    await t.db.delete(taskRequests);
    const second = await requestTask(f, 'Search is slow');
    await setStatus(f, second.taskId, 'IN_PROGRESS');
    await f.dev.browser.post(`/api/v1/requests/${second.id}/accept`).expect(204);
    expect(await statusOf(f, second.taskId)).toBe('IN_PROGRESS');
  });
});

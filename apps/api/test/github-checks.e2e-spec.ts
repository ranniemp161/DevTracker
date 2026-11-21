import { githubPullRequests, projectMessages } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkSuiteEvent,
  deliver,
  githubFixture,
  pullRequestEvent,
  SHA_A,
  SHA_B,
} from './utils/github';
import { createTestApp, type TestApp } from './utils/test-app';

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

type Fixture = Awaited<ReturnType<typeof githubFixture>>;

const openPr = (sha = SHA_A, action = 'opened') =>
  pullRequestEvent(action, { head: { ref: 'feature/dev-1-login', sha } });

const state = async () => (await t.db.select().from(githubPullRequests))[0]?.checksState ?? null;
const failurePosts = async () =>
  (await t.db.select().from(projectMessages)).filter((m) => m.body.startsWith('Checks failed'));

/** Task DEV-1 whose key is in the PR branch, so the PR links automatically. */
async function linkedTask(f: Fixture) {
  return (
    await f.owner.browser
      .post(`/api/v1/projects/${f.project}/tasks`)
      .send({ title: 'Login' })
      .expect(201)
  ).body.data.task.id as string;
}

describe('CI status on pull requests (0015)', () => {
  it('tracks the worst result across apps and re-runs, and posts a failure once', async () => {
    const f = await githubFixture(t);
    const taskId = await linkedTask(f);
    await deliver(t, 'pull_request', openPr()).expect(202);
    expect(await state()).toBeNull();

    await deliver(t, 'check_suite', checkSuiteEvent('failure')).expect(202);
    expect(await state()).toBe('failing');
    const prs = await f.dev.browser.get(`/api/v1/tasks/${taskId}/pull-requests`).expect(200);
    expect(prs.body.data[0].checks).toBe('failing');

    // Another app passing doesn't hide the failure; a second failing suite doesn't post again.
    await deliver(t, 'check_suite', checkSuiteEvent('success', { suiteId: 9002, app: 'vercel' }));
    await deliver(t, 'check_suite', checkSuiteEvent('timed_out', { suiteId: 9003, app: 'circle' }));
    expect(await state()).toBe('failing');
    expect(await failurePosts()).toHaveLength(1);
    expect((await failurePosts())[0]!.body).toBe('Checks failed on PR #12: Fix login');

    // Re-runs that succeed replace the failed results.
    await deliver(t, 'check_suite', checkSuiteEvent('success', { suiteId: 9001 }));
    await deliver(t, 'check_suite', checkSuiteEvent('success', { suiteId: 9003, app: 'circle' }));
    expect(await state()).toBe('passing');
  });

  it('resets on a new commit, ignores old commits, and posts again when the new one fails', async () => {
    const f = await githubFixture(t);
    await linkedTask(f);
    await deliver(t, 'pull_request', openPr(SHA_A)).expect(202);
    await deliver(t, 'check_suite', checkSuiteEvent('failure')).expect(202);
    expect(await state()).toBe('failing');

    await deliver(t, 'pull_request', openPr(SHA_B, 'synchronize')).expect(202);
    expect(await state()).toBeNull();

    // A late result for the old commit changes nothing.
    await deliver(t, 'check_suite', checkSuiteEvent('success', { suiteId: 9010, sha: SHA_A }));
    expect(await state()).toBeNull();

    // Forks: GitHub sends no pull_requests; the head SHA still finds the PR.
    await deliver(
      t,
      'check_suite',
      checkSuiteEvent('failure', { suiteId: 9011, sha: SHA_B, prIds: [] }),
    );
    expect(await state()).toBe('failing');
    expect(await failurePosts()).toHaveLength(2);
  });

  it('shows the CI state of open linked PRs on board tasks', async () => {
    const f = await githubFixture(t);
    const taskId = await linkedTask(f);
    const unlinked = (
      await f.owner.browser
        .post(`/api/v1/projects/${f.project}/tasks`)
        .send({ title: 'No PR here' })
        .expect(201)
    ).body.data.task.id as string;
    const boardChecks = async () => {
      const res = await f.dev.browser.get(`/api/v1/projects/${f.project}/tasks`).expect(200);
      const items = res.body.data as { id: string; checks: string | null }[];
      return {
        linked: items.find((i) => i.id === taskId)!.checks,
        unlinked: items.find((i) => i.id === unlinked)!.checks,
      };
    };

    await deliver(t, 'pull_request', openPr()).expect(202);
    expect(await boardChecks()).toEqual({ linked: null, unlinked: null });

    await deliver(t, 'check_suite', checkSuiteEvent('failure')).expect(202);
    expect(await boardChecks()).toEqual({ linked: 'failing', unlinked: null });

    await deliver(t, 'check_suite', checkSuiteEvent('success', { suiteId: 9001 })).expect(202);
    expect(await boardChecks()).toEqual({ linked: 'passing', unlinked: null });
    const view = await f.dev.browser.get(`/api/v1/tasks/${taskId}`).expect(200);
    expect(view.body.data.task.checks).toBe('passing');

    // A closed PR is history: its checks no longer show on the card.
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('closed', {
        state: 'closed',
        head: { ref: 'feature/dev-1-login', sha: SHA_A },
      }),
    ).expect(202);
    expect(await boardChecks()).toEqual({ linked: null, unlinked: null });
  });

  it("respects the project's chat setting and ignores other actions and repositories", async () => {
    const f = await githubFixture(t);
    await f.owner.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ chatGithubEvents: ['pull_request.merged'] })
      .expect(200);
    await deliver(t, 'pull_request', openPr()).expect(202);
    await deliver(t, 'check_suite', checkSuiteEvent('failure', { action: 'requested' })).expect(
      202,
    );
    expect(await state()).toBeNull();
    await deliver(t, 'check_suite', checkSuiteEvent('failure')).expect(202);
    expect(await state()).toBe('failing');
    expect(await failurePosts()).toEqual([]);

    const elsewhere = checkSuiteEvent('failure', { suiteId: 9100 });
    elsewhere.repository = { id: 9999, full_name: 'acme-org/elsewhere' };
    const res = await deliver(t, 'check_suite', elsewhere).expect(202);
    expect(res.body.data.status).toBe('IGNORED');
  });
});

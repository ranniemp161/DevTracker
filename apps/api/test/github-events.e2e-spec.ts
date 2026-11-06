import {
  accounts,
  activityLogs,
  eq,
  githubCommits,
  githubInstallations,
  githubPullRequests,
  githubRepositories,
  githubReviews,
  githubWebhookDeliveries,
  notifications,
  outboxEvents,
  taskGithubLinks,
} from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRecorder } from '../src/events/event-recorder.service';
import { GithubEventProcessor } from '../src/github/webhooks/github-event-processor.service';
import type { TestUser } from './utils/fixtures';
import {
  commit,
  deliver,
  GH_INSTALLATION,
  GH_REPO,
  githubFixture,
  pr,
  pullRequestEvent,
  pushEvent,
  releaseEvent,
  reviewEvent,
  sender,
} from './utils/github';
import { createTestApp, TEST_CRON_SECRET, type TestApp } from './utils/test-app';

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

/** Task DEV-1, reported by `owner` and assigned to `dev`. */
async function devTask(f: { owner: TestUser; dev: TestUser; project: string }) {
  const res = await f.owner.browser
    .post(`/api/v1/projects/${f.project}/tasks`)
    .send({ title: 'Login is broken', assigneeIds: [f.dev.id] })
    .expect(201);
  return res.body.data.task as { id: string; key: string; status: string };
}

const deliveries = () => t.db.select().from(githubWebhookDeliveries);
const activityOf = (action: string) =>
  t.db.select().from(activityLogs).where(eq(activityLogs.action, action));
/** GitHub notifications only (task creation also notifies assignees). */
const notificationsOf = async (userId: string) =>
  (await t.db.select().from(notifications).where(eq(notifications.userId, userId))).filter((n) =>
    n.type.startsWith('PULL_REQUEST'),
  );

describe('webhook intake', () => {
  it('answers ping without storing anything', async () => {
    await githubFixture(t);
    const res = await deliver(t, 'ping', { zen: 'Keep it logically awesome.' });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('PONG');
    expect(await deliveries()).toEqual([]);
  });

  it('rejects missing or invalid signatures', async () => {
    await githubFixture(t);
    const payload = pushEvent([commit(1)]);
    const wrongSecret = await deliver(t, 'push', payload, { secret: 'not-the-real-secret-123' });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    await deliver(t, 'push', payload, { signature: 'sha256=00' }).expect(401);
    await deliver(t, 'push', payload, { signature: '' }).expect(401);

    // A body changed after signing fails too.
    const body = JSON.stringify(payload);
    const signed = await deliver(t, 'push', body);
    expect(signed.status).toBe(202);
    const tampered = await deliver(t, 'push', body.replace('Commit 1', 'Commit 2'), {
      signature: signed.request.getHeader('X-Hub-Signature-256') as string,
    });
    expect(tampered.status).toBe(401);
    expect(await deliveries()).toHaveLength(1);
  });

  it('is unavailable when no webhook secret is configured', async () => {
    const app = await createTestApp({ githubWebhookSecret: null });
    try {
      const res = await deliver(app, 'ping', {});
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('WEBHOOK_NOT_CONFIGURED');
    } finally {
      await app.close();
    }
  });

  it('validates headers and the JSON body', async () => {
    await githubFixture(t);
    await deliver(t, 'push', 'not json').expect(400);
    await deliver(t, 'push', '[1,2]').expect(400);
    await deliver(t, 'Push Event!', {}).expect(400);
    await deliver(t, 'push', {}, { deliveryId: 'bad id with spaces' }).expect(400);
  });

  it('stores each delivery once and acknowledges duplicates', async () => {
    const f = await githubFixture(t);
    await devTask(f);
    const event = pullRequestEvent('opened');
    const first = await deliver(t, 'pull_request', event, { deliveryId: 'delivery-1' });
    expect(first.status).toBe(202);
    expect(first.body.data).toEqual({ deliveryId: 'delivery-1', status: 'PROCESSED' });

    const again = await deliver(t, 'pull_request', event, { deliveryId: 'delivery-1' });
    expect(again.status).toBe(202);
    expect(again.body.data).toMatchObject({ status: 'PROCESSED', duplicate: true });
    expect(await activityOf('opened')).toHaveLength(1);
    expect(await notificationsOf(f.dev.id)).toHaveLength(1);
  });

  it('drops the payload once processed or ignored, and records why', async () => {
    await githubFixture(t);
    await deliver(t, 'push', pushEvent([commit(1)])).expect(202);
    await deliver(t, 'watch', { action: 'started' }).expect(202);
    const other = pushEvent([commit(2)]);
    other.repository = { id: 9999, full_name: 'acme-org/elsewhere' };
    await deliver(t, 'push', other).expect(202);

    const rows = await deliveries();
    expect(rows.map((r) => [r.eventType, r.processingStatus, r.payload, r.errorMessage])).toEqual(
      expect.arrayContaining([
        ['push', 'PROCESSED', null, null],
        ['watch', 'IGNORED', null, 'event watch is not handled'],
        ['push', 'IGNORED', null, 'repository not connected'],
      ]),
    );
    expect(rows.find((r) => r.githubRepositoryId === 9999)?.githubInstallationId).toBe(
      GH_INSTALLATION,
    );
  });

  it('accepts payloads larger than the default JSON limit', async () => {
    await githubFixture(t);
    const commits = Array.from({ length: 300 }, (_, i) =>
      commit(i + 1, `Change ${i}\n\n${'x'.repeat(1000)}`),
    );
    const res = await deliver(t, 'push', pushEvent(commits));
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('PROCESSED');
    expect(await t.db.select().from(githubCommits)).toHaveLength(300);
  });
});

describe('push', () => {
  it('records new commits once with a single activity entry per push', async () => {
    const f = await githubFixture(t);
    await deliver(t, 'push', pushEvent([commit(1, 'Add login\n\nDetails'), commit(2)])).expect(202);

    const stored = await t.db.select().from(githubCommits);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      branch: 'main',
      authorLogin: 'octo',
      authorName: 'Octo Cat',
    });

    const [pushed] = await activityOf('pushed');
    expect(pushed).toMatchObject({ projectId: f.project, entityType: 'repository', actorId: null });
    expect(pushed!.metadata).toMatchObject({
      repository: 'acme-org/api',
      branch: 'main',
      count: 2,
      commits: [
        { sha: commit(1).id.slice(0, 7), message: 'Add login' },
        { sha: commit(2).id.slice(0, 7), message: 'Commit 2' },
      ],
      github: { login: 'octo' },
    });
    const events = await t.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'github.commit.received'));
    expect(events).toHaveLength(1);

    // The same commits arriving on another branch are not news.
    await deliver(t, 'push', pushEvent([commit(1), commit(2)], 'refs/heads/release')).expect(202);
    expect(await activityOf('pushed')).toHaveLength(1);
  });

  it('ignores tag pushes and branch deletions', async () => {
    await githubFixture(t);
    await deliver(t, 'push', pushEvent([commit(1)], 'refs/tags/v1')).expect(202);
    await deliver(t, 'push', { ...pushEvent([]), deleted: true }).expect(202);
    expect((await deliveries()).map((d) => d.processingStatus)).toEqual(['IGNORED', 'IGNORED']);
    expect(await t.db.select().from(githubCommits)).toEqual([]);
  });

  it('shows the DevTrack user when the GitHub sender signed in with GitHub', async () => {
    const f = await githubFixture(t);
    await t.db
      .insert(accounts)
      .values({ userId: f.dev.id, provider: 'github', providerAccountId: String(sender.id) });
    await deliver(t, 'push', pushEvent([commit(1)])).expect(202);
    const [pushed] = await activityOf('pushed');
    expect(pushed!.actorId).toBe(f.dev.id);

    // ...but only if they belong to the workspace.
    await t.db.delete(accounts);
    await t.db
      .insert(accounts)
      .values({ userId: f.outsider.id, provider: 'github', providerAccountId: String(sender.id) });
    await deliver(t, 'push', pushEvent([commit(2)])).expect(202);
    const latest = (await activityOf('pushed')).find((a) => a.actorId !== f.dev.id);
    expect(latest!.actorId).toBeNull();
  });
});

describe('pull requests', () => {
  it('records an opened PR, links tasks named in the branch, and notifies the task people', async () => {
    const f = await githubFixture(t);
    const task = await devTask(f);

    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);

    const [stored] = await t.db.select().from(githubPullRequests);
    expect(stored).toMatchObject({
      number: 12,
      title: 'Fix login',
      state: 'open',
      headBranch: 'feature/dev-1-login',
      authorLogin: 'octo',
    });
    const links = await t.db.select().from(taskGithubLinks);
    expect(links).toEqual([
      expect.objectContaining({
        taskId: task.id,
        pullRequestId: stored!.id,
        source: 'AUTO',
        linkedBy: null,
      }),
    ]);

    const [opened] = await activityOf('opened');
    expect(opened).toMatchObject({
      entityType: 'pull_request',
      projectId: f.project,
      taskId: null,
    });
    const [linked] = await activityOf('linked');
    expect(linked).toMatchObject({ taskId: task.id });
    expect(linked!.metadata).toMatchObject({ auto: true, pullRequest: { number: 12 } });

    for (const u of [f.dev, f.owner]) {
      const [n] = await notificationsOf(u.id);
      expect(n).toMatchObject({
        type: 'PULL_REQUEST_OPENED',
        title: 'Pull request #12 opened for DEV-1',
        body: 'Fix login',
        resourceType: 'task',
        resourceId: task.id,
      });
    }
    expect(await notificationsOf(f.admin.id)).toEqual([]);

    // The task's history and the GitHub feed show it.
    const history = await f.dev.browser.get(
      `/api/v1/projects/${f.project}/activity?taskId=${task.id}`,
    );
    expect(history.body.data.map((e: { action: string }) => e.action)).toContain(
      'pull_request.linked',
    );
  });

  it('records merges without ever changing task status', async () => {
    const f = await githubFixture(t);
    const task = await devTask(f);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('closed', {
        state: 'closed',
        merged_at: '2026-11-06T12:00:00Z',
        closed_at: '2026-11-06T12:00:00Z',
        updated_at: '2026-11-06T12:00:00Z',
      }),
    ).expect(202);

    const [stored] = await t.db.select().from(githubPullRequests);
    expect(stored!.mergedAt).toBeInstanceOf(Date);
    expect(await activityOf('merged')).toHaveLength(1);
    const merged = (await notificationsOf(f.dev.id)).filter(
      (n) => n.type === 'PULL_REQUEST_MERGED',
    );
    expect(merged).toHaveLength(1);

    const after = await f.dev.browser.get(`/api/v1/tasks/${task.id}`);
    expect(after.body.data.task.status).toBe(task.status);
  });

  it('distinguishes closed from merged, and records updates without feed noise', async () => {
    await githubFixture(t);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('synchronize', { updated_at: '2026-11-06T10:30:00Z' }),
    ).expect(202);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('closed', {
        state: 'closed',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    ).expect(202);
    expect(await activityOf('closed')).toHaveLength(1);
    expect(await activityOf('merged')).toEqual([]);
    const updates = await t.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'github.pull_request.updated'));
    expect(updates).toHaveLength(3);
    expect(
      await t.db.select().from(activityLogs).where(eq(activityLogs.entityType, 'pull_request')),
    ).toHaveLength(2);
  });

  it('never lets an older delivery overwrite newer pull request data', async () => {
    await githubFixture(t);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('edited', { title: 'Newest title', updated_at: '2026-11-06T12:00:00Z' }),
    ).expect(202);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('opened', { title: 'Original title', updated_at: '2026-11-06T10:00:00Z' }),
    ).expect(202);
    const [stored] = await t.db.select().from(githubPullRequests);
    expect(stored!.title).toBe('Newest title');
  });

  it('only auto-links keys of projects the repository is connected to', async () => {
    const f = await githubFixture(t);
    await devTask(f);
    // OPS-1 exists in another project of the workspace, which is not connected to the repo.
    const ops = await f.owner.browser
      .post(`/api/v1/workspaces/${f.ws}/projects`)
      .send({ name: 'Ops', key: 'OPS' })
      .expect(201);
    await f.owner.browser
      .post(`/api/v1/projects/${ops.body.data.project.id}/tasks`)
      .send({ title: 'Ops task' })
      .expect(201);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('opened', {
        head: { ref: 'fix/ops-1' },
        title: 'Fix DEV-1 and DEV-99 and OPS-1',
      }),
    ).expect(202);
    const links = await t.db.select().from(taskGithubLinks);
    expect(links).toHaveLength(1); // DEV-1 only; DEV-99 does not exist
  });

  it('records reviews once and notifies the task people', async () => {
    const f = await githubFixture(t);
    await devTask(f);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);
    await deliver(t, 'pull_request_review', reviewEvent('approved')).expect(202);
    await deliver(t, 'pull_request_review', reviewEvent('approved')).expect(202); // new delivery, same review

    expect(await t.db.select().from(githubReviews)).toEqual([
      expect.objectContaining({
        state: 'approved',
        reviewerLogin: 'reviewer',
        githubReviewId: 8001,
      }),
    ]);
    const [reviewed] = await activityOf('reviewed');
    expect(reviewed!.metadata).toMatchObject({ review: { state: 'approved' } });
    const n = (await notificationsOf(f.dev.id)).filter((x) => x.type === 'PULL_REQUEST_REVIEWED');
    expect(n).toEqual([expect.objectContaining({ title: 'Pull request #12 approved for DEV-1' })]);

    await deliver(t, 'pull_request_review', { ...reviewEvent('dismissed', 8002) }).expect(202);
    expect(await t.db.select().from(githubReviews)).toHaveLength(1);
  });

  it('records published releases in the activity feed', async () => {
    const f = await githubFixture(t);
    await deliver(t, 'release', releaseEvent()).expect(202);
    const [release] = await activityOf('release_published');
    expect(release).toMatchObject({ projectId: f.project, entityType: 'repository' });
    expect(release!.metadata).toMatchObject({ release: { tag: 'v1.2.0', name: 'Spring release' } });
  });

  it('ignores payloads that do not match the expected shape', async () => {
    await githubFixture(t);
    const bad = pullRequestEvent('opened', { html_url: 'javascript:alert(1)' });
    await deliver(t, 'pull_request', bad).expect(202);
    const [row] = await deliveries();
    expect(row).toMatchObject({
      processingStatus: 'IGNORED',
      errorMessage: 'payload does not match the expected shape',
    });
    expect(await t.db.select().from(githubPullRequests)).toEqual([]);
  });
});

describe('pull request API', () => {
  async function withPr() {
    const f = await githubFixture(t);
    const task = await devTask(f);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('opened', { head: { ref: 'no-key' } }),
    ).expect(202);
    const [stored] = await t.db.select().from(githubPullRequests);
    return { ...f, task, prId: stored!.id };
  }

  it('lists a connected repository’s pull requests to people with project access', async () => {
    const f = await withPr();
    const res = await f.dev.browser.get(`/api/v1/repositories/${f.repositoryId}/pull-requests`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: f.prId,
        number: 12,
        state: 'open',
        repository: { id: f.repositoryId, fullName: 'acme-org/api' },
      }),
    ]);
    const merged = await f.dev.browser.get(
      `/api/v1/repositories/${f.repositoryId}/pull-requests?state=merged`,
    );
    expect(merged.body.data).toEqual([]);
    await f.bystander.browser
      .get(`/api/v1/repositories/${f.repositoryId}/pull-requests`)
      .expect(404);
    await f.outsider.browser
      .get(`/api/v1/repositories/${f.repositoryId}/pull-requests`)
      .expect(404);
  });

  it('paginates pull requests newest first', async () => {
    const f = await githubFixture(t);
    for (let n = 1; n <= 3; n++) {
      await deliver(
        t,
        'pull_request',
        pullRequestEvent('opened', {
          id: 7000 + n,
          number: n,
          created_at: `2026-11-0${n}T10:00:00Z`,
        }),
      ).expect(202);
    }
    const page1 = await f.dev.browser.get(
      `/api/v1/repositories/${f.repositoryId}/pull-requests?limit=2`,
    );
    expect(page1.body.data.map((p: { number: number }) => p.number)).toEqual([3, 2]);
    const page2 = await f.dev.browser.get(
      `/api/v1/repositories/${f.repositoryId}/pull-requests?limit=2&cursor=${page1.body.meta.nextCursor}`,
    );
    expect(page2.body.data.map((p: { number: number }) => p.number)).toEqual([1]);
    expect(page2.body.meta.hasMore).toBe(false);
  });

  it('links and unlinks pull requests manually', async () => {
    const f = await withPr();
    const linked = await f.dev.browser
      .post(`/api/v1/tasks/${f.task.id}/pull-requests`)
      .send({ pullRequestId: f.prId });
    expect(linked.status).toBe(201);
    expect(linked.body.data.pullRequest).toMatchObject({
      id: f.prId,
      link: { source: 'MANUAL', linkedBy: expect.objectContaining({ username: 'dev' }) },
    });

    const dup = await f.dev.browser
      .post(`/api/v1/tasks/${f.task.id}/pull-requests`)
      .send({ pullRequestId: f.prId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PULL_REQUEST_ALREADY_LINKED');

    const list = await f.owner.browser.get(`/api/v1/tasks/${f.task.id}/pull-requests`).expect(200);
    expect(list.body.data).toHaveLength(1);
    await f.bystander.browser.get(`/api/v1/tasks/${f.task.id}/pull-requests`).expect(404);
    await f.bystander.browser
      .post(`/api/v1/tasks/${f.task.id}/pull-requests`)
      .send({ pullRequestId: f.prId })
      .expect(404);

    await f.dev.browser.delete(`/api/v1/tasks/${f.task.id}/pull-requests/${f.prId}`).expect(204);
    await f.dev.browser.delete(`/api/v1/tasks/${f.task.id}/pull-requests/${f.prId}`).expect(404);
    expect(await activityOf('unlinked')).toHaveLength(1);
    // Manual linking notifies nobody.
    expect(await notificationsOf(f.owner.id)).toEqual([]);
  });

  it("refuses pull requests from repositories not connected to the task's project", async () => {
    const f = await withPr();
    const other = await f.owner.browser
      .post(`/api/v1/workspaces/${f.ws}/projects`)
      .send({ name: 'Ops', key: 'OPS' })
      .expect(201);
    const opsTask = await f.owner.browser
      .post(`/api/v1/projects/${other.body.data.project.id}/tasks`)
      .send({ title: 'Ops task' })
      .expect(201);
    const res = await f.owner.browser
      .post(`/api/v1/tasks/${opsTask.body.data.task.id}/pull-requests`)
      .send({ pullRequestId: f.prId });
    expect(res.status).toBe(404);
  });

  it('serves a GitHub-only activity feed', async () => {
    const f = await withPr();
    await deliver(t, 'push', pushEvent([commit(1)])).expect(202);
    const res = await f.dev.browser
      .get(`/api/v1/projects/${f.project}/github/activity`)
      .expect(200);
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      'repository.pushed',
      'pull_request.opened',
    ]);
    await f.bystander.browser.get(`/api/v1/projects/${f.project}/github/activity`).expect(404);
  });
});

describe('installation lifecycle', () => {
  it('disconnects repositories GitHub no longer lets DevTrack read', async () => {
    const f = await githubFixture(t);
    await deliver(t, 'installation_repositories', {
      action: 'removed',
      installation: { id: GH_INSTALLATION },
      repositories_removed: [{ id: GH_REPO }],
      sender,
    }).expect(202);

    const connected = await f.owner.browser.get(`/api/v1/projects/${f.project}/repositories`);
    expect(connected.body.data).toEqual([]);
    const [repo] = await t.db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.githubRepositoryId, GH_REPO));
    expect(repo!.disconnectedAt).toBeInstanceOf(Date);
    const [disc] = await activityOf('repository_disconnected');
    expect(disc!.metadata).toMatchObject({ reason: 'access_removed' });

    // Its events are no longer accepted into the project.
    await deliver(t, 'push', pushEvent([commit(1)])).expect(202);
    expect(await t.db.select().from(githubCommits)).toEqual([]);
  });

  it('tracks suspension and removal of the installation', async () => {
    const f = await githubFixture(t);
    const status = async () => (await t.db.select().from(githubInstallations))[0]!.status;
    const event = (action: string) => ({ action, installation: { id: GH_INSTALLATION }, sender });

    await deliver(t, 'installation', event('suspend')).expect(202);
    expect(await status()).toBe('SUSPENDED');
    await deliver(t, 'installation', event('unsuspend')).expect(202);
    expect(await status()).toBe('ACTIVE');
    await deliver(t, 'installation', event('deleted')).expect(202);
    expect(await status()).toBe('REMOVED');
    expect(
      (await f.owner.browser.get(`/api/v1/projects/${f.project}/repositories`)).body.data,
    ).toEqual([]);

    // Installations never bound through the verified flow are ignored.
    await deliver(t, 'installation', { ...event('deleted'), installation: { id: 424242 } }).expect(
      202,
    );
    const last = (await deliveries()).find((d) => d.githubInstallationId === 424242);
    expect(last!.processingStatus).toBe('IGNORED');
  });
});

describe('failures and retries', () => {
  it('keeps a failed delivery and its payload, rolls back partial work, and retries it', async () => {
    const f = await githubFixture(t);
    await devTask(f);
    const recorder = t.app.get(EventRecorder);
    vi.spyOn(recorder, 'notify').mockRejectedValueOnce(new Error('boom'));

    const res = await deliver(t, 'pull_request', pullRequestEvent('opened'), { deliveryId: 'd-1' });
    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('FAILED');
    let [row] = await deliveries();
    expect(row).toMatchObject({ processingStatus: 'FAILED', attempts: 1, errorMessage: 'Error' });
    expect(row!.payload).not.toBeNull();
    // Nothing from the failed attempt was committed.
    expect(await t.db.select().from(githubPullRequests)).toEqual([]);
    expect(await activityOf('opened')).toEqual([]);

    // Authorization for the retry job.
    await t.http().get('/api/v1/internal/github/deliveries/retry').expect(401);
    await t
      .http()
      .get('/api/v1/internal/github/deliveries/retry')
      .set('Authorization', 'Bearer wrong-secret')
      .expect(401);

    const retry = await t
      .http()
      .get('/api/v1/internal/github/deliveries/retry')
      .set('Authorization', `Bearer ${TEST_CRON_SECRET}`);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual({ attempted: 1, processed: 1, failed: 0 });
    [row] = await deliveries();
    expect(row).toMatchObject({
      processingStatus: 'PROCESSED',
      attempts: 2,
      payload: null,
      errorMessage: null,
    });
    expect(await activityOf('opened')).toHaveLength(1);
    expect(await notificationsOf(f.dev.id)).toHaveLength(1);
  });

  it('reprocesses a failed delivery when GitHub redelivers it', async () => {
    await githubFixture(t);
    vi.spyOn(t.app.get(GithubEventProcessor), 'handle').mockRejectedValueOnce(new Error('boom'));
    await deliver(t, 'push', pushEvent([commit(1)]), { deliveryId: 'd-2' }).expect(202);
    const redelivered = await deliver(t, 'push', pushEvent([commit(1)]), { deliveryId: 'd-2' });
    expect(redelivered.body.data.status).toBe('PROCESSED');
    expect(await t.db.select().from(githubCommits)).toHaveLength(1);
  });

  it('gives up after the maximum number of attempts', async () => {
    await githubFixture(t);
    vi.spyOn(t.app.get(GithubEventProcessor), 'handle').mockRejectedValue(new Error('boom'));
    await deliver(t, 'push', pushEvent([commit(1)])).expect(202);
    for (let i = 0; i < 6; i++) {
      await t
        .http()
        .get('/api/v1/internal/github/deliveries/retry')
        .set('Authorization', `Bearer ${TEST_CRON_SECRET}`)
        .expect(200);
    }
    const [row] = await deliveries();
    expect(row).toMatchObject({ processingStatus: 'FAILED', attempts: 5 });
  });

  it('hides the retry job when no cron secret is configured', async () => {
    const app = await createTestApp({ cronSecret: null });
    try {
      await app
        .http()
        .get('/api/v1/internal/github/deliveries/retry')
        .set('Authorization', `Bearer ${TEST_CRON_SECRET}`)
        .expect(404);
    } finally {
      await app.close();
    }
  });
});

describe('importing existing pull requests', () => {
  const history = () => [
    pr({
      id: 9101,
      number: 2,
      title: 'Old fix for DEV-1',
      head: { ref: 'fix/old' },
      state: 'closed',
      merged_at: '2026-11-05T10:00:00Z',
      closed_at: '2026-11-05T10:00:00Z',
      updated_at: '2026-11-05T10:00:00Z',
    }),
    pr({
      id: 9102,
      number: 3,
      title: 'Still open',
      head: { ref: 'feature/x' },
      updated_at: '2026-11-05T11:00:00Z',
    }),
  ];

  it('imports a repository’s pull requests when it is connected, quietly', async () => {
    t.githubApp.pullRequests.set(GH_REPO, history());
    const f = await githubFixture(t);
    const stored = await t.db.select().from(githubPullRequests);
    expect(stored.map((p) => p.number).sort()).toEqual([2, 3]);

    // History is not news: no feed entries, outbox PR events or notifications.
    expect(
      await t.db.select().from(activityLogs).where(eq(activityLogs.entityType, 'pull_request')),
    ).toEqual([]);
    expect(await notificationsOf(f.owner.id)).toEqual([]);

    const list = await f.dev.browser.get(`/api/v1/repositories/${f.repositoryId}/pull-requests`);
    expect(
      list.body.data.map((p: { number: number; state: string }) => [p.number, p.state]),
    ).toEqual([
      [3, 'open'],
      [2, 'merged'],
    ]);
  });

  it('syncs on demand, links task keys, and is idempotent', async () => {
    const f = await githubFixture(t);
    const task = await devTask(f);
    t.githubApp.pullRequests.set(GH_REPO, history());
    const sync = () =>
      f.admin.browser.post(`/api/v1/projects/${f.project}/repositories/${f.repositoryId}/sync`);

    const first = await sync();
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ imported: 2 });
    await sync().expect(200);
    expect(await t.db.select().from(githubPullRequests)).toHaveLength(2);

    const links = await t.db.select().from(taskGithubLinks);
    expect(links).toEqual([expect.objectContaining({ taskId: task.id, source: 'AUTO' })]);
    expect(await activityOf('linked')).toEqual([]);
  });

  it('only lets workspace admins sync, and only connected repositories', async () => {
    const f = await githubFixture(t);
    const path = `/api/v1/projects/${f.project}/repositories/${f.repositoryId}/sync`;
    await f.dev.browser.post(path).expect(403);
    await f.outsider.browser.post(path).expect(404);
    await f.owner.browser
      .post(`/api/v1/projects/${f.project}/repositories/00000000-0000-4000-8000-000000000000/sync`)
      .expect(404);
  });

  it('keeps the connection when the import fails', async () => {
    const original = t.githubApp.listPullRequests.bind(t.githubApp);
    t.githubApp.listPullRequests = async () => {
      throw new Error('GitHub is down');
    };
    try {
      const f = await githubFixture(t);
      const repos = await f.owner.browser.get(`/api/v1/projects/${f.project}/repositories`);
      expect(repos.body.data).toHaveLength(1);
    } finally {
      t.githubApp.listPullRequests = original;
    }
  });
});

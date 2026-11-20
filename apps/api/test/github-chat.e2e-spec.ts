import { chatPushDeliveries, eq, notifications, projectMessages } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliver,
  githubFixture,
  pullRequestEvent,
  pushEvent,
  commit,
  releaseEvent,
  reviewEvent,
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

const chat = async (f: Fixture) => {
  const res = await f.dev.browser.get(`/api/v1/projects/${f.project}/messages`).expect(200);
  return res.body.data.messages as {
    kind: string;
    author: unknown;
    body: string;
    github: Record<string, unknown> | null;
  }[];
};

describe('GitHub updates in chat (0014)', () => {
  it('posts the default events as GitHub messages', async () => {
    const f = await githubFixture(t);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);
    await deliver(t, 'pull_request_review', reviewEvent('changes_requested', 8001)).expect(202);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('closed', { state: 'closed', merged_at: '2026-11-06T12:00:00Z' }),
    ).expect(202);
    await deliver(t, 'release', releaseEvent()).expect(202);

    const messages = await chat(f);
    expect(messages.map((m) => [m.kind, m.author, m.body])).toEqual([
      ['github', null, 'PR #12 opened: Fix login'],
      ['github', null, 'Changes requested on PR #12: Fix login'],
      ['github', null, 'PR #12 merged: Fix login'],
      ['github', null, 'Release Spring release published in acme-org/api'],
    ]);
    expect(messages[0]!.github).toEqual({
      event: 'pull_request.opened',
      repository: 'acme-org/api',
      sender: 'octo',
      pullRequest: {
        number: 12,
        title: 'Fix login',
        url: 'https://github.com/acme-org/api/pull/12',
      },
    });
    expect(messages[3]!.github).toMatchObject({
      event: 'release.published',
      release: { tag: 'v1.2.0', name: 'Spring release' },
    });
  });

  it('skips events that are off, unhandled or noisy', async () => {
    const f = await githubFixture(t);
    // Approvals, plain comments, closes without merge, edits and pushes are off by default
    // or never posted.
    await deliver(t, 'pull_request_review', reviewEvent('approved', 8001)).expect(202);
    await deliver(t, 'pull_request_review', reviewEvent('commented', 8002)).expect(202);
    await deliver(t, 'pull_request', pullRequestEvent('closed', { state: 'closed' })).expect(202);
    await deliver(t, 'pull_request', pullRequestEvent('edited')).expect(202);
    await deliver(t, 'push', pushEvent([commit(1)])).expect(202);
    expect(await chat(f)).toEqual([]);

    // Turning approvals on posts the next one.
    await f.owner.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ chatGithubEvents: ['review.approved'] })
      .expect(200);
    await deliver(t, 'pull_request_review', reviewEvent('approved', 8003)).expect(202);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202); // now off
    expect((await chat(f)).map((m) => m.body)).toEqual(['PR #12 approved: Fix login']);
  });

  it('posts a redelivered event once, counts it as unread, and sends no push', async () => {
    const f = await githubFixture(t);
    const event = pullRequestEvent('opened');
    await deliver(t, 'pull_request', event, { deliveryId: 'same' }).expect(202);
    await deliver(t, 'pull_request', event, { deliveryId: 'same' }).expect(202);
    expect(await chat(f)).toHaveLength(1);

    const unread = await f.dev.browser.get(`/api/v1/workspaces/${f.ws}/chat/unread`).expect(200);
    expect(
      unread.body.data.find((u: { projectId: string }) => u.projectId === f.project).unreadCount,
    ).toBe(1);
    expect(await t.db.select().from(chatPushDeliveries)).toHaveLength(0);
    const chatNotifications = (await t.db.select().from(notifications)).filter(
      (n) => n.resourceType === 'chat_message',
    );
    expect(chatNotifications).toEqual([]);
  });

  it('does not post to archived projects', async () => {
    const f = await githubFixture(t);
    await f.owner.browser.delete(`/api/v1/projects/${f.project}`).expect(204);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);
    const rows = await t.db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, f.project));
    expect(rows).toEqual([]);
  });

  it('cannot be edited, but admins can delete it', async () => {
    const f = await githubFixture(t);
    await deliver(t, 'pull_request', pullRequestEvent('opened')).expect(202);
    const [row] = await t.db.select().from(projectMessages);
    await f.dev.browser.patch(`/api/v1/messages/${row!.id}`).send({ body: 'hijack' }).expect(403);
    await f.dev.browser.delete(`/api/v1/messages/${row!.id}`).expect(403);
    await f.owner.browser.delete(`/api/v1/messages/${row!.id}`).expect(204);
  });

  it('validates the settings and only lets managers change them', async () => {
    const f = await githubFixture(t);
    const project = await f.dev.browser.get(`/api/v1/projects/${f.project}`).expect(200);
    expect(project.body.data.project.chatGithubEvents).toEqual([
      'pull_request.opened',
      'pull_request.merged',
      'review.changes_requested',
      'release.published',
      'checks.failed',
    ]);
    await f.owner.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ chatGithubEvents: ['push'] })
      .expect(400);
    await f.owner.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ chatGithubEvents: ['release.published', 'release.published'] })
      .expect(400);
    await f.dev.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ chatGithubEvents: [] })
      .expect(403);
    const cleared = await f.owner.browser
      .patch(`/api/v1/projects/${f.project}`)
      .send({ chatGithubEvents: [] })
      .expect(200);
    expect(cleared.body.data.project.chatGithubEvents).toEqual([]);
  });
});

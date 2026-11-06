import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_PATH } from '../src/realtime/realtime-io.adapter';
import { joinWorkspace } from './utils/fixtures';
import {
  commit,
  deliver,
  GH_INSTALLATION,
  GH_REPO,
  pullRequestEvent,
  pushEvent,
  REPO_NAME,
} from './utils/github';
import { createTestApp, testConfig, verifiedUser, type TestApp } from './utils/test-app';

/**
 * Architecture §16 end-to-end scenario, steps 1–14, as one journey through the real API:
 * HTTP, signed webhooks and a Socket.IO client. Each step is labelled with its number.
 */
let t: TestApp;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp({ realtime: { ...testConfig().realtime, publishAfterResponse: true } });
  await t.app.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await t.close();
});

function nextEvent(socket: Socket, type: string, match: (e: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${type}`)), 3000);
    const handler = (e: Record<string, unknown>) => {
      if (!match(e)) return;
      clearTimeout(timer);
      socket.off(type, handler);
      resolve(e);
    };
    socket.on(type, handler);
  });
}

describe('§16 end-to-end journey', () => {
  it('runs from registration to live updates', async () => {
    // 1. Register and verify a user (verifiedUser registers, follows the emailed link).
    const lead = await verifiedUser(t, 'lead');
    const teammate = await verifiedUser(t, 'mate');

    // 2. Create a workspace.
    const ws: string = (
      await lead.browser.post('/api/v1/workspaces').send({ name: 'Journey' }).expect(201)
    ).body.data.workspace.id;

    // 3–4. Invite another user; they accept.
    await joinWorkspace(t, lead, ws, teammate, 'MEMBER');

    // 5. Create a project and add the teammate.
    const project: string = (
      await lead.browser
        .post(`/api/v1/workspaces/${ws}/projects`)
        .send({ name: 'Journey App', key: 'JRN' })
        .expect(201)
    ).body.data.project.id;
    await lead.browser
      .post(`/api/v1/projects/${project}/members`)
      .send({ userId: teammate.id })
      .expect(201);

    // 14 (set-up). The teammate is connected and following the project.
    const ticket = (await teammate.browser.post('/api/v1/realtime/token').expect(200)).body.data
      .token;
    const socket = io(url, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      auth: { token: ticket },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('realtime.ready', resolve));
    expect(await socket.emitWithAck('subscribe', { room: `project:${project}` })).toEqual({
      ok: true,
    });

    // 6. Create and assign a task; the assignee hears about it live.
    const assigned = nextEvent(socket, 'notification.created', () => true);
    const task = (
      await lead.browser
        .post(`/api/v1/projects/${project}/tasks`)
        .send({ title: 'Ship the journey', assigneeIds: [teammate.id] })
        .expect(201)
    ).body.data.task as { id: string; key: string };
    expect(task.key).toBe('JRN-1');
    await assigned;

    // 7. Install the GitHub App (verified install flow).
    t.githubApp.addInstallation(GH_INSTALLATION, 'acme-org', [
      {
        id: GH_REPO,
        fullName: REPO_NAME,
        ownerLogin: 'acme-org',
        defaultBranch: 'main',
        visibility: 'private',
      },
    ]);
    t.githubApp.codes.set('journey', [GH_INSTALLATION]);
    const start = await lead.browser.get(`/api/v1/github/install?workspaceId=${ws}`).expect(302);
    const state = new URL(start.headers.location as string).searchParams.get('state')!;
    const done = await lead.browser
      .get(
        `/api/v1/github/install/callback?installation_id=${GH_INSTALLATION}&code=journey&state=${state}`,
      )
      .expect(302);
    expect(new URL(done.headers.location as string).searchParams.get('github')).toBe('installed');
    const installation = (await lead.browser.get(`/api/v1/github/installations?workspaceId=${ws}`))
      .body.data.installations[0];

    // 8. Select and connect a repository.
    const repo = (
      await lead.browser
        .post(`/api/v1/projects/${project}/repositories`)
        .send({ installationId: installation.id, githubRepositoryId: GH_REPO })
        .expect(201)
    ).body.data.repository;

    // 9. Receive a push webhook; the teammate sees it live.
    const pushed = nextEvent(socket, 'github.commit.received', () => true);
    await deliver(t, 'push', pushEvent([commit(1, 'JRN-1 first commit')])).expect(202);
    await pushed;

    // 10. Receive a pull request webhook from a branch named after the task: it links itself.
    const prOpened = nextEvent(socket, 'github.pull_request.updated', () => true);
    await deliver(
      t,
      'pull_request',
      pullRequestEvent('opened', { head: { ref: 'feature/jrn-1-journey' }, title: 'Journey work' }),
    ).expect(202);
    await prOpened;

    // 11. Link a PR to the task (the automatic link is visible; a manual link is also possible).
    const linked = await teammate.browser.get(`/api/v1/tasks/${task.id}/pull-requests`).expect(200);
    expect(linked.body.data).toEqual([
      expect.objectContaining({ number: 12, link: expect.objectContaining({ source: 'AUTO' }) }),
    ]);
    await teammate.browser
      .delete(`/api/v1/tasks/${task.id}/pull-requests/${linked.body.data[0].id}`)
      .expect(204);
    await teammate.browser
      .post(`/api/v1/tasks/${task.id}/pull-requests`)
      .send({ pullRequestId: linked.body.data[0].id })
      .expect(201);
    const prs = await teammate.browser
      .get(`/api/v1/repositories/${repo.id}/pull-requests`)
      .expect(200);
    expect(prs.body.data).toHaveLength(1);

    // 12. Post a comment that mentions the teammate.
    const mentioned = nextEvent(socket, 'notification.created', () => true);
    await lead.browser
      .post(`/api/v1/tasks/${task.id}/comments`)
      .send({ body: 'Looks good @mate' })
      .expect(201);
    await mentioned;

    // 13. Activity and notifications reflect everything.
    const activity = await teammate.browser
      .get(`/api/v1/projects/${project}/activity?limit=50`)
      .expect(200);
    const actions = activity.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'task.created',
        'project.repository_connected',
        'repository.pushed',
        'pull_request.opened',
        'pull_request.linked',
        'comment.created',
      ]),
    );
    const inbox = await teammate.browser.get('/api/v1/notifications').expect(200);
    expect(inbox.body.data.map((n: { type: string }) => n.type)).toEqual(
      expect.arrayContaining(['TASK_ASSIGNED', 'MENTIONED', 'PULL_REQUEST_OPENED']),
    );

    // 14. Live updates reached the authorized, connected teammate (awaited above), and a
    // workspace outsider cannot follow the project.
    const outsider = await verifiedUser(t, 'stranger');
    const outsiderTicket = (await outsider.browser.post('/api/v1/realtime/token').expect(200)).body
      .data.token;
    const outsiderSocket = io(url, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      auth: { token: outsiderTicket },
      reconnection: false,
    });
    sockets.push(outsiderSocket);
    await new Promise((resolve) => outsiderSocket.once('realtime.ready', resolve));
    expect(await outsiderSocket.emitWithAck('subscribe', { room: `project:${project}` })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });
});

import { eq, isNull, outboxEvents, sessions } from '@devtrack/database';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { issueTicket } from '../src/realtime/realtime-ticket';
import { REALTIME_PATH } from '../src/realtime/realtime-io.adapter';
import { projectFixture, type TestUser } from './utils/fixtures';
import { createTestApp, TEST_CRON_SECRET, testConfig, type TestApp } from './utils/test-app';

const realtimeConfig = (overrides: Partial<ReturnType<typeof testConfig>['realtime']> = {}) => ({
  ...testConfig().realtime,
  publishAfterResponse: true,
  ...overrides,
});

let t: TestApp;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  t = await createTestApp({ realtime: realtimeConfig() });
  url = await listen(t);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect();
});

async function listen(app: TestApp): Promise<string> {
  await app.app.listen(0, '127.0.0.1');
  const { port } = app.app.getHttpServer().address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Opens a socket with the given ticket and resolves once the server accepts or refuses it. */
function open(base: string, token: unknown): Promise<{ socket: Socket; ready: boolean }> {
  const socket = io(base, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    auth: { token },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return new Promise((resolve) => {
    socket.once('realtime.ready', () => resolve({ socket, ready: true }));
    socket.once('disconnect', () => resolve({ socket, ready: false }));
    socket.once('connect_error', () => resolve({ socket, ready: false }));
  });
}

async function connect(u: TestUser, base = url, app = t): Promise<Socket> {
  const res = await u.browser.post('/api/v1/realtime/token').expect(200);
  void app;
  const { socket, ready } = await open(base, res.body.data.token);
  expect(ready).toBe(true);
  return socket;
}

const subscribe = (socket: Socket, room: string) =>
  socket.emitWithAck('subscribe', { room }) as Promise<{ ok: boolean; error?: string }>;

/** Resolves with the first `event` matching `match`, or rejects after `ms`. */
function next<T = Record<string, unknown>>(
  socket: Socket,
  event: string,
  match: (payload: T) => boolean = () => true,
  ms = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`no ${event} within ${ms} ms`));
    }, ms);
    const handler = (payload: T) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Collects every event a socket receives. */
function record(socket: Socket): string[] {
  const seen: string[] = [];
  socket.onAny((event: string) => seen.push(event));
  return seen;
}

const settle = () => new Promise((r) => setTimeout(r, 300));

describe('connection tickets', () => {
  it('issues tickets to signed-in users only', async () => {
    const { dev } = await projectFixture(t);
    await t.http().post('/api/v1/realtime/token').expect(401);
    const res = await dev.browser.post('/api/v1/realtime/token').expect(200);
    expect(res.body.data).toEqual({ token: expect.any(String), expiresAt: expect.any(String) });
  });

  it('accepts a valid ticket and refuses invalid, expired and revoked ones', async () => {
    const { dev } = await projectFixture(t);
    await connect(dev);

    expect((await open(url, 'not-a-ticket')).ready).toBe(false);
    expect((await open(url, undefined)).ready).toBe(false);

    const [session] = await t.db.select().from(sessions).where(eq(sessions.userId, dev.id));
    const secret = t.config.realtime.secret;
    const expired = issueTicket(secret, { sid: session!.id, uid: dev.id }, Date.now() - 61_000);
    expect((await open(url, expired.token)).ready).toBe(false);
    const forged = issueTicket('another-secret-0123456789abcdef0123', {
      sid: session!.id,
      uid: dev.id,
    });
    expect((await open(url, forged.token)).ready).toBe(false);

    // A ticket outlives nothing: after logout the session is gone and the ticket is refused.
    const ticket = (await dev.browser.post('/api/v1/realtime/token').expect(200)).body.data.token;
    await dev.browser.post('/api/v1/auth/logout').expect(204);
    expect((await open(url, ticket)).ready).toBe(false);
  });

  it('closes connections after the maximum connection age', async () => {
    const short = await createTestApp({ realtime: realtimeConfig({ maxConnectionMs: 300 }) });
    try {
      const base = await listen(short);
      const { dev } = await projectFixture(short);
      const socket = await connect(dev, base, short);
      const reason = await new Promise((resolve) => socket.once('disconnect', resolve));
      expect(reason).toBe('io server disconnect');
    } finally {
      await short.close();
    }
  });
});

describe('room authorization', () => {
  it('only lets people join rooms they can access', async () => {
    const { dev, bystander, outsider, ws, project } = await projectFixture(t);
    const devSocket = await connect(dev);
    expect(await subscribe(devSocket, `project:${project}`)).toEqual({ ok: true });
    expect(await subscribe(devSocket, `workspace:${ws}`)).toEqual({ ok: true });

    const bystanderSocket = await connect(bystander);
    expect(await subscribe(bystanderSocket, `project:${project}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });

    const outsiderSocket = await connect(outsider);
    expect(await subscribe(outsiderSocket, `workspace:${ws}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    // Personal rooms and made-up names can never be joined by request.
    expect(await subscribe(outsiderSocket, `user:${dev.id}`)).toEqual({
      ok: false,
      error: 'INVALID_ROOM',
    });
    expect(await subscribe(outsiderSocket, 'project:../../etc')).toEqual({
      ok: false,
      error: 'INVALID_ROOM',
    });
  });
});

describe('delivery', () => {
  it('publishes project events to the project room right after the change', async () => {
    const { owner, dev, bystander, project } = await projectFixture(t);
    const devSocket = await connect(dev);
    await subscribe(devSocket, `project:${project}`);
    const bystanderSocket = await connect(bystander);
    const bystanderEvents = record(bystanderSocket);

    const created = next(devSocket, 'task.created');
    const res = await owner.browser
      .post(`/api/v1/projects/${project}/tasks`)
      .send({ title: 'Live task' })
      .expect(201);
    const event = await created;
    expect(event).toMatchObject({
      id: expect.any(String),
      type: 'task.created',
      version: 1,
      projectId: project,
      entity: { type: 'task', id: res.body.data.task.id },
    });

    await settle();
    expect(bystanderEvents).toEqual([]);
    const unpublished = await t.db
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt));
    expect(unpublished).toEqual([]);
  });

  it('delivers notifications only to their recipient, without subscribing', async () => {
    const { owner, dev, admin, project } = await projectFixture(t);
    const devSocket = await connect(dev);
    const adminSocket = await connect(admin);
    const adminEvents = record(adminSocket);

    const notified = next(devSocket, 'notification.created');
    await owner.browser
      .post(`/api/v1/projects/${project}/tasks`)
      .send({ title: 'For dev', assigneeIds: [dev.id] })
      .expect(201);
    expect(await notified).toMatchObject({ entity: { type: 'user', id: dev.id } });

    await settle();
    expect(adminEvents.filter((e) => e.startsWith('notification.'))).toEqual([]);
  });
});

describe('scheduled outbox sweep', () => {
  it('publishes rows the after-response flush missed and skips stale ones', async () => {
    const quiet = await createTestApp(); // publishAfterResponse off
    try {
      const { owner, project } = await projectFixture(quiet);
      await owner.browser
        .post(`/api/v1/projects/${project}/tasks`)
        .send({ title: 'A' })
        .expect(201);
      const pending = await quiet.db
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt));
      expect(pending.length).toBeGreaterThan(0);
      // Pretend one was left behind long ago.
      await quiet.db
        .update(outboxEvents)
        .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(outboxEvents.id, pending[0]!.id));

      await quiet.http().get('/api/v1/internal/realtime/outbox/flush').expect(401);
      const res = await quiet
        .http()
        .get('/api/v1/internal/realtime/outbox/flush')
        .set('Authorization', `Bearer ${TEST_CRON_SECRET}`)
        .expect(200);
      expect(res.body.data).toEqual({ published: pending.length - 1, skippedStale: 1 });
      expect(
        await quiet.db.select().from(outboxEvents).where(isNull(outboxEvents.publishedAt)),
      ).toEqual([]);
    } finally {
      await quiet.close();
    }
  });
});

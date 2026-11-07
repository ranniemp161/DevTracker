import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  eq,
  sessions,
  users,
  workspaces,
  workspaceMembers,
  projects,
  projectMembers,
} from '@devtrack/database';
import { createTestDatabase } from '@devtrack/database/testing';
import { issueTicket } from '@devtrack/server-core';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRealtimeServer, REALTIME_PATH } from '../src/server.js';
import { connectRedis } from '../src/redis.js';

const secret = 'test-only-realtime-secret-at-least-32-characters';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const running: Awaited<ReturnType<typeof createRealtimeServer>>[] = [];
const sockets: Socket[] = [];
let fixture: Awaited<ReturnType<typeof seed>>;

async function seed() {
  const ids = Object.fromEntries(
    ['owner', 'admin', 'dev', 'bystander', 'outsider', 'unverified'].map((name) => [
      name,
      randomUUID(),
    ]),
  );
  await database.db.insert(users).values(
    Object.entries(ids).map(([name, id]) => ({
      id,
      username: name,
      email: `${name}@example.test`,
      emailVerifiedAt: name === 'unverified' ? null : new Date(),
    })),
  );
  const ws = randomUUID();
  await database.db
    .insert(workspaces)
    .values({ id: ws, name: 'Acme', slug: 'acme', ownerId: ids.owner! });
  await database.db.insert(workspaceMembers).values(
    ['owner', 'admin', 'dev', 'bystander'].map((name) => ({
      workspaceId: ws,
      userId: ids[name]!,
      role:
        name === 'owner'
          ? ('OWNER' as const)
          : name === 'admin'
            ? ('ADMIN' as const)
            : ('MEMBER' as const),
    })),
  );
  const project = randomUUID();
  await database.db
    .insert(projects)
    .values({ id: project, workspaceId: ws, name: 'Platform', key: 'DEV' });
  await database.db.insert(projectMembers).values({ projectId: project, userId: ids.dev! });
  const sessionIds: Record<string, string> = {};
  for (const [name, userId] of Object.entries(ids)) {
    const id = randomUUID();
    sessionIds[name] = id;
    await database.db
      .insert(sessions)
      .values({ id, userId, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) });
  }
  return { ids, sessionIds, ws, project };
}

beforeAll(async () => {
  database = await createTestDatabase();
});
beforeEach(async () => {
  await database.truncateAll();
  fixture = await seed();
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const instance of running.splice(0)) await instance.close();
});
afterAll(async () => {
  await database.close();
});

async function start(extra: { redisUrl?: string; maxConnectionMs?: number } = {}) {
  const instance = await createRealtimeServer({
    db: database.db,
    secret,
    webOrigin: 'https://website.example.test',
    ...extra,
  });
  running.push(instance);
  await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(instance.server.address() as AddressInfo).port}`;
  return { ...instance, url };
}

const tokenFor = (name = 'dev', key = secret, now = Date.now(), uid = fixture.ids[name]!) =>
  issueTicket(key, { sid: fixture.sessionIds[name]!, uid }, now).token;

async function open(url: string, token: unknown = tokenFor(), origin?: string) {
  const socket = io(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    auth: token === null ? {} : { token },
    reconnection: false,
    autoConnect: false,
    extraHeaders: origin ? { Origin: origin } : undefined,
  });
  sockets.push(socket);
  const result = new Promise<{ ready?: { userId: string }; error?: string }>((resolve) => {
    socket.once('realtime.ready', (ready) => resolve({ ready }));
    socket.once('realtime.error', (error) => resolve({ error: error.code }));
    socket.once('connect_error', () => resolve({ error: 'CONNECT_ERROR' }));
  });
  socket.connect();
  return { socket, ...(await result) };
}

const subscribe = (socket: Socket, room: unknown) =>
  socket.timeout(2000).emitWithAck('subscribe', { room });
const next = (socket: Socket, event: string) =>
  new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 2000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

describe('standalone authentication and transport', () => {
  it('accepts an API-compatible ticket, joins only its personal room, and rejects polling', async () => {
    const server = await start();
    const connection = await open(server.url, tokenFor(), 'https://website.example.test');
    expect(connection.ready).toEqual({ userId: fixture.ids.dev });
    expect(connection.socket.io.engine.transport.name).toBe('websocket');
    expect(server.io.sockets.sockets.get(connection.socket.id!)?.rooms).toEqual(
      new Set([connection.socket.id, `user:${fixture.ids.dev}`]),
    );
    const response = await fetch(`${server.url}${REALTIME_PATH}/?EIO=4&transport=polling`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 0 });
  });

  it('refuses missing, malformed, forged, expired, wrong-user and unverified tickets', async () => {
    const server = await start();
    for (const token of [
      null,
      42,
      {},
      'fake',
      tokenFor('dev', 'wrong-key'),
      tokenFor('dev', secret, Date.now() - 61_000),
      tokenFor('dev', secret, Date.now(), fixture.ids.owner!),
      tokenFor('unverified'),
    ]) {
      expect((await open(server.url, token)).error).toBe('UNAUTHENTICATED');
    }
    expect((await open(server.url, tokenFor(), 'https://untrusted.example.test')).error).toBe(
      'CONNECT_ERROR',
    );
  });

  it('rechecks revoked and expired sessions', async () => {
    const server = await start();
    const token = tokenFor();
    await database.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, fixture.sessionIds.dev!));
    expect((await open(server.url, token)).error).toBe('UNAUTHENTICATED');
    await database.db.delete(sessions).where(eq(sessions.id, fixture.sessionIds.dev!));
    expect((await open(server.url, token)).error).toBe('UNAUTHENTICATED');
  });

  it('closes at the configured lifetime and requires current access on reconnect', async () => {
    const server = await start({ maxConnectionMs: 200 });
    const { socket } = await open(server.url);
    expect(await subscribe(socket, `project:${fixture.project}`)).toEqual({ ok: true });
    const disconnected = next(socket, 'disconnect');
    await database.db.delete(projectMembers).where(eq(projectMembers.userId, fixture.ids.dev!));
    expect(await disconnected).toBe('io server disconnect');
    const reconnected = await open(server.url);
    expect(await subscribe(reconnected.socket, `project:${fixture.project}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });
});

describe('shared room authorization', () => {
  it('enforces workspace and project access, admin visibility, and personal-room isolation', async () => {
    const server = await start();
    const { socket: dev } = await open(server.url);
    expect(await dev.timeout(2000).emitWithAck('subscribe', null)).toEqual({
      ok: false,
      error: 'INVALID_ROOM',
    });
    expect(await subscribe(dev, `project:${fixture.project}`)).toEqual({ ok: true });
    expect(await subscribe(dev, `workspace:${fixture.ws}`)).toEqual({ ok: true });
    const { socket: bystander } = await open(server.url, tokenFor('bystander'));
    expect(await subscribe(bystander, `project:${fixture.project}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    const { socket: outsider } = await open(server.url, tokenFor('outsider'));
    expect(await subscribe(outsider, `workspace:${fixture.ws}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await subscribe(outsider, `project:${randomUUID()}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    for (const room of [`user:${fixture.ids.dev}`, 'project:../../etc', {}, null]) {
      expect(await subscribe(dev, room)).toEqual({ ok: false, error: 'INVALID_ROOM' });
    }
    const { socket: admin } = await open(server.url, tokenFor('admin'));
    expect(await subscribe(admin, `project:${fixture.project}`)).toEqual({ ok: true });
    expect(
      await admin.timeout(2000).emitWithAck('unsubscribe', { room: `project:${fixture.project}` }),
    ).toEqual({ ok: true });
    expect(server.io.sockets.sockets.get(admin.id!)?.rooms.has(`project:${fixture.project}`)).toBe(
      false,
    );
    await database.db
      .update(workspaces)
      .set({ archivedAt: new Date() })
      .where(eq(workspaces.id, fixture.ws));
    const fresh = await open(server.url, tokenFor('admin'));
    expect(await subscribe(fresh.socket, `workspace:${fixture.ws}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    expect(await subscribe(fresh.socket, `project:${fixture.project}`)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  it('serializes concurrent joins and caps client rooms at 50 while allowing duplicates', async () => {
    const server = await start();
    const rows = await database.db
      .insert(projects)
      .values(
        Array.from({ length: 51 }, (_, index) => ({
          workspaceId: fixture.ws,
          name: `P${index}`,
          key: `P${index}`,
        })),
      )
      .returning();
    const { socket } = await open(server.url, tokenFor('owner'));
    const results = await Promise.all(rows.map((row) => subscribe(socket, `project:${row.id}`)));
    expect(results.filter((result) => result.ok)).toHaveLength(50);
    expect(results[50]).toEqual({ ok: false, error: 'TOO_MANY_ROOMS' });
    expect(await subscribe(socket, `project:${rows[0]!.id}`)).toEqual({ ok: true });
    await socket.timeout(2000).emitWithAck('unsubscribe', { room: `project:${rows[0]!.id}` });
    expect(await subscribe(socket, `project:${rows[50]!.id}`)).toEqual({ ok: true });
  });
});

it.skipIf(!process.env.TEST_REDIS_URL)(
  'delivers API-style Redis broadcasts across servers only to authorized rooms',
  async () => {
    const receiver = await start({ redisUrl: process.env.TEST_REDIS_URL });
    const publisher = new Server(createServer(), { transports: ['websocket'] });
    const redis = await connectRedis(publisher, process.env.TEST_REDIS_URL!);
    try {
      const { socket: dev } = await open(receiver.url);
      const { socket: owner } = await open(receiver.url, tokenFor('owner'));
      const { socket: outsider } = await open(receiver.url, tokenFor('outsider'));
      const leaked: string[] = [];
      outsider.onAny((event) => leaked.push(event));
      await subscribe(dev, `project:${fixture.project}`);
      await subscribe(owner, `project:${fixture.project}`);
      expect(await subscribe(outsider, `project:${fixture.project}`)).toEqual({
        ok: false,
        error: 'NOT_FOUND',
      });
      const envelope = {
        id: randomUUID(),
        type: 'task.updated',
        projectId: fixture.project,
        workspaceId: fixture.ws,
        entity: { type: 'task', id: randomUUID() },
        payload: { status: 'DONE' },
      };
      const delivered = [next(dev, 'task.updated'), next(owner, 'task.updated')];
      publisher.to(`project:${fixture.project}`).emit('task.updated', envelope);
      expect(await Promise.all(delivered)).toEqual([envelope, envelope]);
      const personalLeaks: unknown[] = [];
      owner.on('notification.created', (event) => personalLeaks.push(event));
      const notification = next(dev, 'notification.created');
      publisher.to(`user:${fixture.ids.dev}`).emit('notification.created', { id: 'personal' });
      expect(await notification).toEqual({ id: 'personal' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(leaked).toEqual([]);
      expect(personalLeaks).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => publisher.close(() => resolve()));
      await redis.close();
    }
  },
);

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, outboxEvents } from '@devtrack/database';
import { findActiveSession, userRoom, verifyTicket } from '@devtrack/server-core';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { io, type Socket } from 'socket.io-client';
import { expect, it } from 'vitest';
import { REALTIME_PATH } from '../src/realtime/realtime-io.adapter';
import { OutboxPublisher } from '../src/realtime/outbox-publisher.service';
import { projectFixture } from './utils/fixtures';
import { createTestApp, testConfig } from './utils/test-app';

it.skipIf(!process.env.TEST_REDIS_URL)(
  'publishes comment notifications through Redis when no API gateway is registered',
  async () => {
    const realtime = {
      ...testConfig().realtime,
      redisUrl: process.env.TEST_REDIS_URL!,
      publishAfterResponse: true,
    };
    const app = await createTestApp({ realtime }, { gateway: false });
    const http = createServer();
    const receiver = new Server(http, { path: REALTIME_PATH, transports: ['websocket'] });
    const pub = createClient({ url: process.env.TEST_REDIS_URL });
    const sub = pub.duplicate();
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);
    let client: Socket | undefined;
    try {
      await Promise.all([pub.connect(), sub.connect()]);
      receiver.adapter(createAdapter(pub, sub));
      receiver.on('connection', async (socket) => {
        const claims = verifyTicket(realtime.secret, socket.handshake.auth.token);
        const session = claims && (await findActiveSession(app.db, claims.sid));
        if (
          !claims ||
          !session ||
          session.user.id !== claims.uid ||
          !session.user.emailVerifiedAt
        ) {
          socket.disconnect(true);
          return;
        }
        await socket.join(userRoom(session.user.id));
        socket.emit('realtime.ready');
      });
      await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
      const { owner, dev, project } = await projectFixture(app);
      const task = await owner.browser
        .post(`/api/v1/projects/${project}/tasks`)
        .send({ title: 'Comment notification', assigneeIds: [dev.id] })
        .expect(201);
      // Drain setup events before connecting: a delayed assignment hint must not be mistaken
      // for the comment notification below. The comment still relies on after-response flush.
      await app.app.get(OutboxPublisher).flush();
      const ticket = await dev.browser.post('/api/v1/realtime/token').expect(200);
      // The receiver is separate from the API, as in production. It uses an actual API ticket.
      const socket = io(`http://127.0.0.1:${(http.address() as AddressInfo).port}`, {
        path: REALTIME_PATH,
        transports: ['websocket'],
        autoConnect: false,
        reconnection: false,
        auth: { token: ticket.body.data.token },
      });
      client = socket;
      await new Promise<void>((resolve, reject) => {
        socket.once('realtime.ready', resolve);
        socket.once('connect_error', reject);
        socket.connect();
      });
      const delivered = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Comment notification was not published')),
          3000,
        );
        socket.once('notification.created', (event) => {
          clearTimeout(timeout);
          resolve(event);
        });
      });
      await owner.browser
        .post(`/api/v1/tasks/${task.body.data.task.id}/comments`)
        .send({ body: 'A new comment' })
        .expect(201);
      expect(await delivered).toMatchObject({
        type: 'notification.created',
        entity: { type: 'user', id: dev.id },
        payload: { type: 'COMMENT_RECEIVED' },
      });
      // Re-read through REST: this is the count the bell should fetch on receipt of the hint.
      const count = await dev.browser.get('/api/v1/notifications/unread-count').expect(200);
      expect(count.body.data.count).toBe(2); // assignment + comment
      await expect
        .poll(async () => {
          const rows = await app.db
            .select()
            .from(outboxEvents)
            .where(eq(outboxEvents.eventType, 'notification.created'));
          return rows.every((row) => row.publishedAt !== null);
        })
        .toBe(true);
    } finally {
      client?.disconnect();
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
      await Promise.allSettled([pub.quit(), sub.quit()]);
      await app.close();
    }
  },
);

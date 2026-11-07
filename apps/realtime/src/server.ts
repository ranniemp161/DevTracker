import { createServer } from 'node:http';
import type { Database } from '@devtrack/database';
import {
  findActiveSession,
  findProjectAccess,
  findWorkspaceAccess,
  parseSubscribableRoom,
  userRoom,
  verifyTicket,
} from '@devtrack/server-core';
import { Server } from 'socket.io';
import { connectRedis } from './redis.js';

export const REALTIME_PATH = '/api/v1/realtime/socket';
export const MAX_CONNECTION_MS = 270_000;
const MAX_ROOMS = 50;
type Ack = (result: { ok: boolean; error?: string }) => void;

export interface RealtimeOptions {
  db: Database;
  secret: string;
  webOrigin: string;
  redisUrl?: string;
  /** Shorter lifetimes for tests; production always uses 4.5 minutes. */
  maxConnectionMs?: number;
}

/** No writes: authorization uses the same queries as REST; events arrive through Redis. */
export async function createRealtimeServer(options: RealtimeOptions) {
  const server = createServer((_request, response) => response.writeHead(404).end());
  const io = new Server(server, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    serveClient: false,
    cors: { origin: [options.webOrigin], credentials: false },
    // CORS alone does not restrict WebSocket upgrades. Originless CLI clients still need tickets.
    allowRequest: (request, callback) => {
      callback(null, !request.headers.origin || request.headers.origin === options.webOrigin);
    },
  });
  const redis = options.redisUrl ? await connectRedis(io, options.redisUrl) : null;

  io.on('connection', (socket) => {
    let userId: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    let queue = Promise.resolve();
    socket.on('disconnect', () => {
      if (timer) clearTimeout(timer);
    });
    const acknowledge = (ack: unknown, result: Parameters<Ack>[0]) => {
      if (typeof ack === 'function') (ack as Ack)(result);
    };
    const handleRoom = (subscribe: boolean, body: unknown, ack: unknown) => {
      // Serialize joins/leaves so concurrent requests cannot bypass the 50-room limit.
      queue = queue
        .then(async () => {
          if (!socket.connected) return;
          if (!userId) return acknowledge(ack, { ok: false, error: 'UNAUTHENTICATED' });
          const room = parseSubscribableRoom(
            body && typeof body === 'object' && 'room' in body ? body.room : undefined,
          );
          if (!room) {
            return acknowledge(
              ack,
              subscribe ? { ok: false, error: 'INVALID_ROOM' } : { ok: true },
            );
          }
          const name = `${room.kind}:${room.id}`;
          if (!subscribe) {
            await socket.leave(name);
            return acknowledge(ack, { ok: true });
          }
          if (socket.rooms.has(name)) return acknowledge(ack, { ok: true });
          if (socket.rooms.size - 2 >= MAX_ROOMS) {
            return acknowledge(ack, { ok: false, error: 'TOO_MANY_ROOMS' });
          }
          const access =
            room.kind === 'workspace'
              ? await findWorkspaceAccess(options.db, userId, room.id)
              : await findProjectAccess(options.db, userId, room.id);
          if (!access) return acknowledge(ack, { ok: false, error: 'NOT_FOUND' });
          // A disconnect during authorization must never rejoin a room or retain a timer.
          if (!socket.connected) return;
          await socket.join(name);
          acknowledge(ack, { ok: true });
        })
        .catch(() => {
          console.error('Realtime room authorization failed');
          acknowledge(ack, { ok: false, error: 'INTERNAL_ERROR' });
        });
    };
    socket.on('subscribe', (body: unknown, ack: unknown) => handleRoom(true, body, ack));
    socket.on('unsubscribe', (body: unknown, ack: unknown) => handleRoom(false, body, ack));

    void (async () => {
      const claims = verifyTicket(options.secret, socket.handshake.auth?.token);
      const auth = claims ? await findActiveSession(options.db, claims.sid) : null;
      if (!socket.connected) return;
      if (!claims || !auth || auth.user.id !== claims.uid || !auth.user.emailVerifiedAt) {
        socket.emit('realtime.error', { code: 'UNAUTHENTICATED' });
        socket.disconnect(true);
        return;
      }
      await socket.join(userRoom(auth.user.id));
      if (!socket.connected) return;
      userId = auth.user.id;
      timer = setTimeout(
        () => socket.disconnect(true),
        options.maxConnectionMs ?? MAX_CONNECTION_MS,
      );
      timer.unref();
      socket.emit('realtime.ready', { userId });
    })().catch(() => {
      console.error('Realtime connection authorization failed');
      socket.emit('realtime.error', { code: 'INTERNAL_ERROR' });
      socket.disconnect(true);
    });
  });

  return {
    server,
    io,
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await redis?.close();
    },
  };
}

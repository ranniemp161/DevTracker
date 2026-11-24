import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server } from 'socket.io';

/**
 * Sent to every local socket after the Redis subscriber reconnects. Redis Pub/Sub delivers at
 * most once, so broadcasts published while the subscriber was away are lost; the client
 * reconciles as if it had reconnected itself. Its socket never dropped, so nothing else would
 * tell it.
 */
export const RESYNC_EVENT = 'realtime.resync';

/** PING interval for both clients: detects connections that died without closing. */
export const REDIS_PING_INTERVAL_MS = 60_000;

/** Connection name shown in Redis `CLIENT LIST`, so these connections can be identified. */
export const REDIS_CLIENT_NAME = 'devtrack-realtime';

/** Connect before accepting clients; clean up even when only one connection succeeds. */
export async function connectRedis(io: Server, url: string) {
  let initialized = false;
  const pub = createClient({
    url,
    name: REDIS_CLIENT_NAME,
    pingInterval: REDIS_PING_INTERVAL_MS,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) =>
        !initialized && retries >= 5 ? false : Math.min(100 * 2 ** Math.min(retries, 5), 2000),
    },
  });
  const sub = pub.duplicate();
  // Do not log client errors: provider messages may contain credential-bearing URLs.
  pub.on('error', () => console.error('Realtime Redis publisher connection failed'));
  sub.on('error', () => console.error('Realtime Redis subscriber connection failed'));
  const close = async () => {
    await Promise.allSettled(
      [pub, sub].map(async (client) => {
        if (client.isReady) await client.quit();
        else if (client.isOpen) client.destroy();
      }),
    );
  };
  const results = await Promise.allSettled([pub.connect(), sub.connect()]);
  if (results.some((result) => result.status === 'rejected')) {
    await close();
    throw new Error('Realtime Redis initialization failed');
  }
  io.adapter(createAdapter(pub, sub));
  initialized = true;
  // Registered after the first connect, so it only fires on reconnects. node-redis emits
  // `ready` after it has re-sent the adapter's subscriptions.
  sub.on('ready', () => {
    console.warn('Realtime Redis subscriber reconnected; asking clients to resync');
    io.local.emit(RESYNC_EVENT);
  });
  return { close };
}

import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server } from 'socket.io';

/** Connect before accepting clients; clean up even when only one connection succeeds. */
export async function connectRedis(io: Server, url: string) {
  let initialized = false;
  const pub = createClient({
    url,
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
  return { close };
}

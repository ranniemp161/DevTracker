import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { Server, ServerOptions } from 'socket.io';
import type { AppConfig } from '../config/app-config';

/**
 * Socket.IO endpoint path. Socket.IO answers every URL under it, so REST routes must not live
 * below it (e.g. `/api/v1/realtime/token` stays outside).
 */
export const REALTIME_PATH = '/api/v1/realtime/socket';

/** Startup gives up on Redis after this many failed attempts (decision record 0007). */
export const REDIS_STARTUP_RETRIES = 5;
const REDIS_CONNECT_TIMEOUT_MS = 5_000;
const REDIS_MAX_BACKOFF_MS = 2_000;

/** Only the error code, never the message: provider messages can contain the Redis URL. */
function redisErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

/**
 * Socket.IO server options for DevTrack:
 * - WebSocket transport only: Vercel Functions do not support HTTP long-polling.
 * - CORS limited to the website origin. Authentication uses a ticket, not cookies.
 * - With `REDIS_URL`, the Redis adapter broadcasts across function instances.
 * - If Redis can't be reached at startup, the API still starts. Live updates pause: the
 *   publisher leaves outbox rows unpublished until a transport is ready (`isTransportReady`).
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly redisLogger = new Logger(RealtimeIoAdapter.name);
  private redisAdapter: ReturnType<typeof createAdapter> | null = null;
  private closeRedis: (() => Promise<void>) | null = null;
  private defaultServer: Server | null = null;
  private readonly closing = new WeakMap<Server, Promise<void>>();

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfig,
  ) {
    super(app);
  }

  /** Without Redis configured (local dev, tests) the in-process server is the transport. */
  private transportReady: () => boolean = () => !this.config.realtime.redisUrl;

  /** Whether `server.to(...).emit()` currently reaches other instances. */
  isTransportReady(): boolean {
    return this.transportReady();
  }

  /**
   * Connects to Redis before the app starts, if configured. Bounded: each attempt times out
   * after 5 s and startup gives up after a few retries, so a Redis outage can't hold up the API.
   * Once connected, the clients keep reconnecting with capped backoff.
   */
  async connect(): Promise<void> {
    const url = this.config.realtime.redisUrl;
    if (!url) return;
    let initialized = false;
    const pub = createClient({
      url,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: (retries) =>
          !initialized && retries >= REDIS_STARTUP_RETRIES
            ? false
            : Math.min(100 * 2 ** Math.min(retries, 5), REDIS_MAX_BACKOFF_MS),
      },
    });
    const sub = pub.duplicate();
    for (const [role, client] of [
      ['publisher', pub],
      ['subscriber', sub],
    ] as const) {
      let failing = false;
      client.on('error', (err: unknown) => {
        if (failing) return; // one line per outage, not one per retry
        failing = true;
        this.redisLogger.error(`Redis ${role} connection failed (${redisErrorCode(err)})`);
      });
      client.on('ready', () => {
        if (failing) this.redisLogger.log(`Redis ${role} connection restored`);
        failing = false;
      });
    }
    const close = async () => {
      await Promise.allSettled(
        [pub, sub].map(async (client) => {
          if (client.isReady) await client.quit();
          else if (client.isOpen) client.destroy();
        }),
      );
    };

    const results = await Promise.allSettled([pub.connect(), sub.connect()]);
    if (results.some((r) => r.status === 'rejected')) {
      await close();
      this.redisLogger.warn(
        'Redis unavailable at startup; serving without live updates (outbox rows stay queued)',
      );
      return;
    }
    initialized = true;
    this.redisAdapter = createAdapter(pub, sub);
    this.transportReady = () => pub.isReady && sub.isReady;
    this.closeRedis = close;
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Startup attaches the publisher first; Nest's optional gateway must reuse that server.
    if (port === 0 && this.defaultServer) return this.defaultServer;
    const server: Server = super.createIOServer(port, {
      ...options,
      path: REALTIME_PATH,
      transports: ['websocket'],
      cors: { origin: [this.config.webOrigin], credentials: false },
      serveClient: false,
    } as ServerOptions);
    if (this.redisAdapter) server.adapter(this.redisAdapter);
    if (port === 0) this.defaultServer = server;
    return server;
  }

  override async close(server: Server): Promise<void> {
    const existing = this.closing.get(server);
    if (existing) return existing;
    // Both Nest and the publisher may close it. The publisher also owns cleanup when Nest's
    // optional websocket module is absent and will never invoke the adapter's close hook.
    const closing = (async () => {
      await super.close(server);
      const closeRedis = this.closeRedis;
      this.closeRedis = null;
      await closeRedis?.();
    })();
    this.closing.set(server, closing);
    return closing;
  }
}

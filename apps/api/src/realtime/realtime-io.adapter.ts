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

/**
 * Socket.IO server options for DevTrack:
 * - WebSocket transport only: Vercel Functions do not support HTTP long-polling.
 * - CORS limited to the website origin. Authentication uses a ticket, not cookies.
 * - With `REDIS_URL`, the Redis adapter broadcasts across function instances.
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

  /** Connects to Redis before the app starts, if configured. */
  async connect(): Promise<void> {
    if (!this.config.realtime.redisUrl) return;
    const pub = createClient({ url: this.config.realtime.redisUrl });
    const sub = pub.duplicate();
    const onError = (err: Error) => this.redisLogger.error(`Redis error: ${err.message}`);
    pub.on('error', onError);
    sub.on('error', onError);
    await Promise.all([pub.connect(), sub.connect()]);
    this.redisAdapter = createAdapter(pub, sub);
    this.closeRedis = async () => {
      await Promise.allSettled([pub.quit(), sub.quit()]);
    };
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

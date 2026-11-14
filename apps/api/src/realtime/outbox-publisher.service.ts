import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { asc, inArray, isNull, outboxEvents, sql, type Database } from '@devtrack/database';
import type { Server } from 'socket.io';
import { describeError } from '../common/filters/all-exceptions.filter';
import { DATABASE } from '../database/database.module';
import { reportError } from '../observability/sentry';
import { roomsFor, type OutboxEnvelope } from './rooms';

/** Rows per transaction. */
const BATCH = 100;
/** Upper bound per flush, to stay inside serverless time limits. */
const MAX_BATCHES = 10;
/**
 * Events older than this are marked published without being sent: clients that were away
 * that long reconcile from the API when they reconnect (decision record 0007).
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

export interface FlushResult {
  published: number;
  skippedStale: number;
  /** True when nothing was sent because the transport (Redis) is down; rows stay queued. */
  paused?: true;
}

/**
 * Delivers unpublished `outbox_events` rows to Socket.IO rooms (architecture §10) and sets
 * `published_at`. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so concurrent flushes (after
 * several responses, or the scheduled sweep) never send the same row twice at once.
 * Delivery is at least once: clients deduplicate by the envelope `id`.
 *
 * With Redis configured, `server.to(room).emit()` reaches sockets on every instance.
 */
@Injectable()
export class OutboxPublisher implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisher.name);
  private server: Server | null = null;
  private running: Promise<FlushResult> | null = null;
  private again = false;
  private closeTransport: (() => Promise<void>) | null = null;
  private transportReady: () => boolean = () => true;
  private pausedLogged = false;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Called explicitly by setupRealtime before app.init(), independently of gateway hooks. */
  attach(
    server: Server,
    closeTransport?: () => Promise<void>,
    transportReady: () => boolean = () => true,
  ): void {
    this.server = server;
    this.closeTransport = closeTransport ?? null;
    this.transportReady = transportReady;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.running?.catch(() => undefined);
    await this.closeTransport?.();
    this.closeTransport = null;
    this.server = null;
  }

  /**
   * Flushes now. A call made while a flush is running schedules one more pass instead of
   * running in parallel inside this process.
   */
  flush(): Promise<FlushResult> {
    if (!this.server) {
      return Promise.reject(new Error('Realtime publisher transport has not been initialized'));
    }
    // Emitting without Redis would reach no one; marking rows published would lose them.
    if (!this.transportReady()) {
      if (!this.pausedLogged) {
        this.pausedLogged = true;
        this.logger.warn('Realtime transport unavailable; outbox rows stay queued');
      }
      return Promise.resolve({ published: 0, skippedStale: 0, paused: true });
    }
    this.pausedLogged = false;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      const total: FlushResult = { published: 0, skippedStale: 0 };
      do {
        this.again = false;
        for (let i = 0; i < MAX_BATCHES; i++) {
          const batch = await this.flushBatch();
          total.published += batch.published;
          total.skippedStale += batch.skippedStale;
          if (batch.published + batch.skippedStale < BATCH) break;
        }
      } while (this.again);
      return total;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Never throws: used after responses, where nobody is waiting for the result. */
  async flushQuietly(): Promise<void> {
    try {
      await this.flush();
    } catch (err) {
      this.logger.error('Outbox flush failed', describeError(err));
      reportError(err, { job: 'outbox-flush' });
    }
  }

  private async flushBatch(): Promise<FlushResult> {
    const server = this.server;
    if (!server) throw new Error('Realtime publisher transport has not been initialized');
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outboxEvents)
        .where(isNull(outboxEvents.publishedAt))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(BATCH)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return { published: 0, skippedStale: 0 };

      const staleBefore = Date.now() - STALE_AFTER_MS;
      let published = 0;
      let skippedStale = 0;
      for (const row of rows) {
        if (row.createdAt.getTime() < staleBefore) {
          skippedStale++;
          continue;
        }
        const envelope = row.payload as unknown as OutboxEnvelope;
        const rooms = roomsFor(row.eventType, row.aggregateId, envelope);
        // §10 envelope, plus the outbox row ID for client-side deduplication.
        if (rooms.length) server.to(rooms).emit(row.eventType, { id: row.id, ...row.payload });
        published++;
      }
      await tx
        .update(outboxEvents)
        .set({ publishedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
        .where(
          inArray(
            outboxEvents.id,
            rows.map((r) => r.id),
          ),
        );
      return { published, skippedStale };
    });
  }
}

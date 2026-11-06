import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  githubWebhookDeliveries,
  inArray,
  lt,
  or,
  sql,
  type Database,
} from '@devtrack/database';
import { ErrorCode } from '@devtrack/types';
import { AppException } from '../../common/errors/app.exception';
import { describeError } from '../../common/filters/all-exceptions.filter';
import { reportError } from '../../observability/sentry';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import { GithubEventProcessor } from './github-event-processor.service';
import { routingFields } from './payloads';
import { verifyWebhookSignature } from './webhook-signature';

type DeliveryStatus = (typeof githubWebhookDeliveries.$inferSelect)['processingStatus'];

/** Failed deliveries are retried at most this many times in total. */
export const MAX_DELIVERY_ATTEMPTS = 5;
/** A delivery left PROCESSING this long was interrupted (e.g. the function was stopped). */
const STALE_PROCESSING_MS = 10 * 60 * 1000;
/** RECEIVED deliveries older than this were never picked up after being stored. */
const STALE_RECEIVED_MS = 2 * 60 * 1000;
/** Keep one retry run well inside serverless time limits. */
const RETRY_BATCH = 20;
const RETRY_BUDGET_MS = 20_000;

export interface WebhookHeaders {
  event?: string;
  deliveryId?: string;
  signature?: string;
}

const badRequest = (message: string) => AppException.validation([{ path: 'headers', message }]);

/**
 * Durable webhook intake (architecture §11.7–§11.8, decision record 0006).
 *
 * 1. Verify the HMAC signature over the raw body.
 * 2. Store the delivery once (unique GitHub delivery ID); duplicates are acknowledged.
 * 3. Process it in the same request. The event's changes and the PROCESSED status commit in
 *    one transaction, so a delivery is applied exactly once.
 * 4. On failure the delivery is FAILED with its payload kept; the scheduled retry job
 *    reprocesses it. GitHub itself does not retry failed deliveries.
 *
 * Payloads are cleared once a delivery is PROCESSED or IGNORED (open decision #7).
 */
@Injectable()
export class WebhookDeliveriesService {
  private readonly logger = new Logger(WebhookDeliveriesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: GithubEventProcessor,
  ) {}

  async receive(
    headers: WebhookHeaders,
    body: unknown,
  ): Promise<{ deliveryId: string | null; status: DeliveryStatus | 'PONG'; duplicate?: true }> {
    const secret = this.config.githubWebhookSecret;
    if (!secret) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.WEBHOOK_NOT_CONFIGURED,
        'GitHub webhooks are not configured on this server.',
      );
    }
    if (!Buffer.isBuffer(body) || !verifyWebhookSignature(secret, body, headers.signature)) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.WEBHOOK_SIGNATURE_INVALID,
        'Invalid webhook signature.',
      );
    }
    const event = headers.event;
    const deliveryId = headers.deliveryId;
    if (!event || !/^[a-z_]{1,50}$/.test(event)) throw badRequest('Missing X-GitHub-Event.');
    if (!deliveryId || !/^[A-Za-z0-9-]{1,100}$/.test(deliveryId)) {
      throw badRequest('Missing X-GitHub-Delivery.');
    }
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(body.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      payload = parsed as Record<string, unknown>;
    } catch {
      throw AppException.validation([{ path: 'body', message: 'Body must be a JSON object.' }]);
    }
    if (event === 'ping') return { deliveryId, status: 'PONG' };

    const [row] = await this.db
      .insert(githubWebhookDeliveries)
      .values({ deliveryId, eventType: event, payload, ...routingFields(payload) })
      .onConflictDoNothing()
      .returning({ id: githubWebhookDeliveries.id });
    if (!row) {
      // A redelivery. GitHub's "Redeliver" on a delivery we failed is a useful manual retry.
      const [existing] = await this.db
        .select({
          id: githubWebhookDeliveries.id,
          status: githubWebhookDeliveries.processingStatus,
        })
        .from(githubWebhookDeliveries)
        .where(eq(githubWebhookDeliveries.deliveryId, deliveryId));
      if (existing?.status === 'FAILED') {
        return { deliveryId, status: await this.process(existing.id) };
      }
      return { deliveryId, status: existing?.status ?? 'RECEIVED', duplicate: true };
    }
    return { deliveryId, status: await this.process(row.id) };
  }

  /**
   * Claims and processes one delivery. The claim is a single conditional UPDATE, so a live
   * request and the retry job can never process the same delivery at the same time.
   */
  async process(id: string): Promise<DeliveryStatus> {
    const now = new Date();
    const [claimed] = await this.db
      .update(githubWebhookDeliveries)
      .set({
        processingStatus: 'PROCESSING',
        attempts: sql`${githubWebhookDeliveries.attempts} + 1`,
        lastAttemptAt: now,
      })
      .where(
        and(
          eq(githubWebhookDeliveries.id, id),
          or(
            inArray(githubWebhookDeliveries.processingStatus, ['RECEIVED', 'FAILED']),
            and(
              eq(githubWebhookDeliveries.processingStatus, 'PROCESSING'),
              lt(
                githubWebhookDeliveries.lastAttemptAt,
                new Date(now.getTime() - STALE_PROCESSING_MS),
              ),
            ),
          ),
        ),
      )
      .returning();
    if (!claimed) {
      const [current] = await this.db
        .select({ status: githubWebhookDeliveries.processingStatus })
        .from(githubWebhookDeliveries)
        .where(eq(githubWebhookDeliveries.id, id));
      return current?.status ?? 'RECEIVED';
    }

    try {
      return await this.db.transaction(async (tx) => {
        const result = await this.processor.handle(tx, claimed.eventType, claimed.payload);
        await tx
          .update(githubWebhookDeliveries)
          .set({
            processingStatus: result.status,
            processedAt: new Date(),
            payload: null,
            errorMessage: result.reason ?? null,
          })
          .where(eq(githubWebhookDeliveries.id, id));
        return result.status;
      });
    } catch (err) {
      // Never log the payload; describeError redacts SQL parameters.
      this.logger.error(
        `GitHub delivery ${claimed.deliveryId} (${claimed.eventType}) failed on attempt ${claimed.attempts}`,
        describeError(err),
      );
      reportError(err, {
        deliveryId: claimed.deliveryId,
        event: claimed.eventType,
        attempt: claimed.attempts,
      });
      await this.db
        .update(githubWebhookDeliveries)
        .set({ processingStatus: 'FAILED', errorMessage: shortError(err) })
        .where(eq(githubWebhookDeliveries.id, id));
      return 'FAILED';
    }
  }

  /**
   * Scheduled recovery: reprocesses FAILED deliveries (up to `MAX_DELIVERY_ATTEMPTS`) and
   * deliveries that were stored but never finished. Bounded per run.
   */
  async retryPending(): Promise<{ attempted: number; processed: number; failed: number }> {
    const now = Date.now();
    const due = await this.db
      .select({ id: githubWebhookDeliveries.id })
      .from(githubWebhookDeliveries)
      .where(
        or(
          and(
            eq(githubWebhookDeliveries.processingStatus, 'FAILED'),
            lt(githubWebhookDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
          ),
          and(
            eq(githubWebhookDeliveries.processingStatus, 'RECEIVED'),
            lt(githubWebhookDeliveries.receivedAt, new Date(now - STALE_RECEIVED_MS)),
          ),
          and(
            eq(githubWebhookDeliveries.processingStatus, 'PROCESSING'),
            lt(githubWebhookDeliveries.lastAttemptAt, new Date(now - STALE_PROCESSING_MS)),
            lt(githubWebhookDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
          ),
        ),
      )
      .orderBy(asc(githubWebhookDeliveries.receivedAt))
      .limit(RETRY_BATCH);

    const counts = { attempted: 0, processed: 0, failed: 0 };
    for (const { id } of due) {
      if (Date.now() - now > RETRY_BUDGET_MS) break;
      counts.attempted++;
      const status = await this.process(id);
      if (status === 'FAILED') counts.failed++;
      else counts.processed++;
    }
    return counts;
  }
}

/** A short, payload-free description for `error_message`. */
function shortError(err: unknown): string {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `database error ${code}`;
    current = current.cause;
  }
  return err instanceof Error ? `${err.name}`.slice(0, 100) : 'unknown error';
}

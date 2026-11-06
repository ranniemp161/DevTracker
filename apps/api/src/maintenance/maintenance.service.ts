import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  emailVerificationTokens,
  eq,
  githubInstallStates,
  gte,
  githubWebhookDeliveries,
  isNotNull,
  isNull,
  lt,
  min,
  notifications,
  oauthStates,
  outboxEvents,
  passwordResetTokens,
  rateLimitBuckets,
  sessions,
  type Database,
} from '@devtrack/database';
import { DATABASE } from '../database/database.module';
import { MAX_DELIVERY_ATTEMPTS } from '../github/webhooks/webhook-deliveries.service';

const DAY = 24 * 60 * 60 * 1000;

/** Retention policy (decision record 0008, open decision #7). */
export const RETENTION = {
  webhookDeliveriesDays: 30,
  publishedOutboxDays: 7,
  readNotificationsDays: 90,
  /** The longest rate-limit window is one day. */
  rateLimitBucketsDays: 2,
} as const;

export interface PruneResult {
  webhookDeliveries: number;
  outboxEvents: number;
  notifications: number;
  sessions: number;
  emailVerificationTokens: number;
  passwordResetTokens: number;
  oauthStates: number;
  githubInstallStates: number;
  rateLimitBuckets: number;
}

/** Operational status for monitoring (§15: delivery status, outbox backlog and retries). */
export interface OpsStatus {
  outbox: { unpublished: number; oldestUnpublishedAt: string | null };
  webhooks: {
    failed: number;
    retryable: number;
    pending: number;
    /** Gave up after every retry within the last 24 hours (the alert threshold). */
    exhaustedLast24h: number;
  };
}

/**
 * Daily housekeeping. Removes operational data only. Product history (activity, tasks,
 * comments, pull requests, commits, reviews) is kept.
 */
@Injectable()
export class MaintenanceService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async prune(now = new Date()): Promise<PruneResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY);
    const removed = async (query: Promise<unknown[]>) => (await query).length;
    const id = { id: githubWebhookDeliveries.id };

    return {
      webhookDeliveries: await removed(
        this.db
          .delete(githubWebhookDeliveries)
          .where(lt(githubWebhookDeliveries.receivedAt, before(RETENTION.webhookDeliveriesDays)))
          .returning(id),
      ),
      outboxEvents: await removed(
        this.db
          .delete(outboxEvents)
          .where(
            and(
              isNotNull(outboxEvents.publishedAt),
              lt(outboxEvents.publishedAt, before(RETENTION.publishedOutboxDays)),
            ),
          )
          .returning({ id: outboxEvents.id }),
      ),
      notifications: await removed(
        this.db
          .delete(notifications)
          .where(
            and(
              isNotNull(notifications.readAt),
              lt(notifications.readAt, before(RETENTION.readNotificationsDays)),
            ),
          )
          .returning({ id: notifications.id }),
      ),
      sessions: await removed(
        this.db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id }),
      ),
      emailVerificationTokens: await removed(
        this.db
          .delete(emailVerificationTokens)
          .where(lt(emailVerificationTokens.expiresAt, now))
          .returning({ id: emailVerificationTokens.id }),
      ),
      passwordResetTokens: await removed(
        this.db
          .delete(passwordResetTokens)
          .where(lt(passwordResetTokens.expiresAt, now))
          .returning({ id: passwordResetTokens.id }),
      ),
      oauthStates: await removed(
        this.db
          .delete(oauthStates)
          .where(lt(oauthStates.expiresAt, now))
          .returning({ id: oauthStates.id }),
      ),
      githubInstallStates: await removed(
        this.db
          .delete(githubInstallStates)
          .where(lt(githubInstallStates.expiresAt, now))
          .returning({ id: githubInstallStates.id }),
      ),
      rateLimitBuckets: await removed(
        this.db
          .delete(rateLimitBuckets)
          .where(lt(rateLimitBuckets.windowStartedAt, before(RETENTION.rateLimitBucketsDays)))
          .returning({ key: rateLimitBuckets.key }),
      ),
    };
  }

  async status(): Promise<OpsStatus> {
    const [outbox] = await this.db
      .select({ unpublished: count(), oldest: min(outboxEvents.createdAt) })
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt));
    const byStatus = await this.db
      .select({ status: githubWebhookDeliveries.processingStatus, n: count() })
      .from(githubWebhookDeliveries)
      .groupBy(githubWebhookDeliveries.processingStatus);
    const [retryable] = await this.db
      .select({ n: count() })
      .from(githubWebhookDeliveries)
      .where(
        and(
          eq(githubWebhookDeliveries.processingStatus, 'FAILED'),
          lt(githubWebhookDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
        ),
      );
    const [exhausted] = await this.db
      .select({ n: count() })
      .from(githubWebhookDeliveries)
      .where(
        and(
          eq(githubWebhookDeliveries.processingStatus, 'FAILED'),
          gte(githubWebhookDeliveries.attempts, MAX_DELIVERY_ATTEMPTS),
          gte(githubWebhookDeliveries.lastAttemptAt, new Date(Date.now() - DAY)),
        ),
      );
    const n = (status: string) => byStatus.find((r) => r.status === status)?.n ?? 0;
    return {
      outbox: {
        unpublished: outbox?.unpublished ?? 0,
        oldestUnpublishedAt: outbox?.oldest ? new Date(outbox.oldest).toISOString() : null,
      },
      webhooks: {
        failed: n('FAILED'),
        retryable: retryable?.n ?? 0,
        pending: n('RECEIVED') + n('PROCESSING'),
        exhaustedLast24h: exhausted?.n ?? 0,
      },
    };
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  chatPushDeliveries,
  chatPushPreferences,
  chatPushSubscriptions,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  projectMessageMentions,
  projectMessages,
  sessions,
  sql,
  type Database,
  type Executor,
} from '@devtrack/database';
import { findProjectAccess } from '@devtrack/server-core';
import { sendNotification } from 'web-push';
import { DATABASE } from '../database/database.module';

type PushMode = 'off' | 'mentions' | 'all';
type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
type Delivery = typeof chatPushDeliveries.$inferSelect;

const TTL_SECONDS = 3600;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private get vapid() {
    const { WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT } = process.env;
    return WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY && WEB_PUSH_SUBJECT
      ? {
          publicKey: WEB_PUSH_PUBLIC_KEY,
          privateKey: WEB_PUSH_PRIVATE_KEY,
          subject: WEB_PUSH_SUBJECT,
        }
      : null;
  }

  async settings(userId: string, sessionId: string, projectId: string) {
    const [preference] = await this.db
      .select({ mode: chatPushPreferences.mode })
      .from(chatPushPreferences)
      .where(
        and(eq(chatPushPreferences.projectId, projectId), eq(chatPushPreferences.userId, userId)),
      );
    const [device] = await this.db
      .select({ id: chatPushSubscriptions.id })
      .from(chatPushSubscriptions)
      .where(eq(chatPushSubscriptions.sessionId, sessionId))
      .limit(1);
    return {
      mode: preference?.mode ?? 'off',
      publicKey: this.vapid?.publicKey ?? null,
      deviceEnabled: Boolean(device),
    };
  }

  async enable(sessionId: string, input: SubscriptionInput) {
    const fields = { sessionId, p256dh: input.keys.p256dh, auth: input.keys.auth };
    await this.db
      .insert(chatPushSubscriptions)
      .values({ endpoint: input.endpoint, ...fields })
      .onConflictDoUpdate({ target: chatPushSubscriptions.endpoint, set: fields });
  }

  async disable(sessionId: string) {
    await this.db
      .delete(chatPushSubscriptions)
      .where(eq(chatPushSubscriptions.sessionId, sessionId));
  }

  async setMode(userId: string, projectId: string, mode: PushMode) {
    if (mode === 'off') {
      await this.db
        .delete(chatPushPreferences)
        .where(
          and(eq(chatPushPreferences.projectId, projectId), eq(chatPushPreferences.userId, userId)),
        );
      return;
    }
    await this.db
      .insert(chatPushPreferences)
      .values({ projectId, userId, mode })
      .onConflictDoUpdate({
        target: [chatPushPreferences.projectId, chatPushPreferences.userId],
        set: { mode },
      });
  }

  async enqueue(
    tx: Executor,
    projectId: string,
    messageId: string,
    authorId: string,
    mentionedIds: string[],
  ) {
    if (!this.vapid) return;
    await tx.insert(chatPushDeliveries).select(
      tx
        .select({
          id: sql<string>`gen_random_uuid()`.as('id'),
          messageId: sql<string>`${messageId}::uuid`.as('message_id'),
          subscriptionId: chatPushSubscriptions.id,
          userId: sessions.userId,
          attempts: sql<number>`0`.as('attempts'),
          nextAttemptAt: sql<Date>`now()`.as('next_attempt_at'),
        })
        .from(chatPushPreferences)
        .innerJoin(sessions, eq(sessions.userId, chatPushPreferences.userId))
        .innerJoin(chatPushSubscriptions, eq(chatPushSubscriptions.sessionId, sessions.id))
        .where(
          and(
            eq(chatPushPreferences.projectId, projectId),
            ne(sessions.userId, authorId),
            gt(sessions.expiresAt, new Date()),
            or(
              eq(chatPushPreferences.mode, 'all'),
              mentionedIds.length ? inArray(sessions.userId, mentionedIds) : undefined,
            ),
          ),
        ),
    );
  }

  async flush() {
    const vapid = this.vapid;
    if (!vapid) return;
    const now = new Date();
    const deliveries = await this.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: chatPushDeliveries.id })
        .from(chatPushDeliveries)
        .where(lte(chatPushDeliveries.nextAttemptAt, now))
        .orderBy(asc(chatPushDeliveries.nextAttemptAt))
        .limit(20)
        .for('update', { skipLocked: true });
      if (!due.length) return [];
      return tx
        .update(chatPushDeliveries)
        .set({
          nextAttemptAt: new Date(now.getTime() + LEASE_MS),
          attempts: sql`${chatPushDeliveries.attempts} + 1`,
        })
        .where(
          inArray(
            chatPushDeliveries.id,
            due.map(({ id }) => id),
          ),
        )
        .returning();
    });
    await Promise.all(deliveries.map((delivery) => this.deliver(delivery, vapid)));
  }

  async flushQuietly() {
    try {
      await this.flush();
    } catch {
      this.logger.warn('Chat push delivery queue could not be processed.');
    }
  }

  private async deliver(delivery: Delivery, vapid: NonNullable<ChatPushService['vapid']>) {
    const [target] = await this.db
      .select({
        endpoint: chatPushSubscriptions.endpoint,
        p256dh: chatPushSubscriptions.p256dh,
        auth: chatPushSubscriptions.auth,
        sessionId: sessions.id,
        projectId: projectMessages.projectId,
        createdAt: projectMessages.createdAt,
        mode: chatPushPreferences.mode,
        mentionedUserId: projectMessageMentions.mentionedUserId,
      })
      .from(chatPushSubscriptions)
      .innerJoin(sessions, eq(chatPushSubscriptions.sessionId, sessions.id))
      .innerJoin(projectMessages, eq(projectMessages.id, delivery.messageId))
      .innerJoin(
        chatPushPreferences,
        and(
          eq(chatPushPreferences.projectId, projectMessages.projectId),
          eq(chatPushPreferences.userId, sessions.userId),
        ),
      )
      .leftJoin(
        projectMessageMentions,
        and(
          eq(projectMessageMentions.messageId, projectMessages.id),
          eq(projectMessageMentions.mentionedUserId, sessions.userId),
        ),
      )
      .where(
        and(
          eq(chatPushSubscriptions.id, delivery.subscriptionId),
          eq(sessions.userId, delivery.userId),
          gt(sessions.expiresAt, new Date()),
          isNull(projectMessages.deletedAt),
        ),
      );

    const ttl = target
      ? TTL_SECONDS - Math.floor((Date.now() - target.createdAt.getTime()) / 1000)
      : 0;
    if (
      target &&
      ttl > 0 &&
      delivery.attempts <= MAX_ATTEMPTS &&
      (target.mode === 'all' || target.mentionedUserId) &&
      (await findProjectAccess(this.db, delivery.userId, target.projectId))
    ) {
      try {
        await sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify({ projectId: target.projectId, messageId: delivery.messageId }),
          {
            vapidDetails: vapid,
            timeout: 5000,
            TTL: ttl,
            topic: delivery.messageId.replaceAll('-', ''),
          },
        );
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.db
            .delete(chatPushSubscriptions)
            .where(
              and(
                eq(chatPushSubscriptions.id, delivery.subscriptionId),
                eq(chatPushSubscriptions.sessionId, target.sessionId),
                eq(chatPushSubscriptions.auth, target.auth),
                eq(chatPushSubscriptions.p256dh, target.p256dh),
              ),
            );
        } else if (
          (!status || status === 429 || status >= 500) &&
          delivery.attempts < MAX_ATTEMPTS
        ) {
          return;
        } else {
          this.logger.warn('A chat push notification was rejected by its push provider.');
        }
      }
    }
    await this.db.delete(chatPushDeliveries).where(eq(chatPushDeliveries.id, delivery.id));
  }
}

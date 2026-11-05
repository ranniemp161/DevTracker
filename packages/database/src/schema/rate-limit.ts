import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * M1 addition (approved, gap #4): fixed-window rate-limit counters.
 * Serverless instances share no memory, so counters must live in shared storage.
 * `key` is a SHA-256 hash of the logical key, so emails/IPs are not stored in plaintext.
 */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
});

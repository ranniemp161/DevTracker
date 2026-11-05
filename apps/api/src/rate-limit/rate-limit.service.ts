import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { rateLimitBuckets, type Database, sql } from '@devtrack/database';
import { ErrorCode } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { hashToken } from '../common/crypto/tokens';
import { DATABASE } from '../database/database.module';

export interface RateLimitRule {
  /** Logical bucket name, e.g. `login:ip`. */
  name: string;
  limit: number;
  windowSeconds: number;
}

/** Central list of limits so they are easy to review and tune. */
export const RATE_LIMITS = {
  registerPerIp: { name: 'register:ip', limit: 20, windowSeconds: 3600 },
  loginPerIp: { name: 'login:ip', limit: 100, windowSeconds: 900 },
  loginPerIpAndEmail: { name: 'login:ip-email', limit: 10, windowSeconds: 900 },
  forgotPasswordPerEmail: { name: 'forgot:email', limit: 3, windowSeconds: 3600 },
  forgotPasswordPerIp: { name: 'forgot:ip', limit: 20, windowSeconds: 3600 },
  resendVerificationPerUser: { name: 'resend-verify:user', limit: 5, windowSeconds: 3600 },
  tokenRedeemPerIp: { name: 'token-redeem:ip', limit: 30, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window rate limiter backed by PostgreSQL (gap #4: serverless instances share no
 * memory). One atomic upsert per check. Keys are hashed so emails/IPs are not stored.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Counts one attempt; throws 429 RATE_LIMITED (with Retry-After) when over the limit. */
  async consume(rule: RateLimitRule, subject: string): Promise<void> {
    const key = hashToken(`${rule.name}:${subject}`);
    const expired = sql`${rateLimitBuckets.windowStartedAt} <= now() - make_interval(secs => ${rule.windowSeconds}::int)`;

    const [row] = await this.db
      .insert(rateLimitBuckets)
      .values({ key, count: 1, windowStartedAt: sql`now()` })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
          windowStartedAt: sql`CASE WHEN ${expired} THEN now() ELSE ${rateLimitBuckets.windowStartedAt} END`,
        },
      })
      .returning({
        count: rateLimitBuckets.count,
        windowStartedAt: rateLimitBuckets.windowStartedAt,
      });

    if (row && row.count > rule.limit) {
      const resetAt = row.windowStartedAt.getTime() + rule.windowSeconds * 1000;
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'Too many attempts. Please try again later.',
        undefined,
        { 'Retry-After': String(retryAfter) },
      );
    }
  }
}

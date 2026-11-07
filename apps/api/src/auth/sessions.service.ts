import { findActiveSession } from '@devtrack/server-core';
import { Inject, Injectable } from '@nestjs/common';
import { sessions, users, type Database, type Executor, and, eq, gt } from '@devtrack/database';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { DATABASE } from '../database/database.module';
import type { User } from '../users/users.service';

export type Session = typeof sessions.$inferSelect;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Database-backed opaque sessions (decision record 0001). The raw token exists only in the
 * user's HTTP-only cookie; the database stores its SHA-256 hash. Revocation = row deletion.
 */
@Injectable()
export class SessionsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(userId: string, executor: Executor = this.db) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const [session] = await executor
      .insert(sessions)
      .values({ userId, tokenHash: hashToken(token), expiresAt })
      .returning();
    return { token, session: session!, expiresAt };
  }

  /** Resolves a raw session token to its (unexpired) session and user. */
  async authenticate(token: string): Promise<{ user: User; session: Session } | null> {
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  }

  /** A session by ID, if it still exists and has not expired (real-time connections, M7). */
  async findActive(sessionId: string): Promise<{ user: User; session: Session } | null> {
    return findActiveSession(this.db, sessionId);
  }

  async revoke(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async revokeAllForUser(userId: string, executor: Executor = this.db): Promise<void> {
    await executor.delete(sessions).where(eq(sessions.userId, userId));
  }
}

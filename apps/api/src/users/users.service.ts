import { Inject, Injectable } from '@nestjs/common';
import { users, type Database, type Executor, eq, inArray } from '@devtrack/database';
import type { PublicUser } from '@devtrack/types';
import { USERNAME_PATTERN } from '@devtrack/validators';
import { randomBytes } from 'node:crypto';
import { DATABASE } from '../database/database.module';

export type User = typeof users.$inferSelect;

/** Strips secrets (password hash) and normalizes for the API. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string, executor: Executor = this.db): Promise<User | undefined> {
    const [user] = await executor.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  /** `email` must already be normalized (validators do this). */
  async findByEmail(email: string, executor: Executor = this.db): Promise<User | undefined> {
    const [user] = await executor.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async findByUsername(username: string, executor: Executor = this.db): Promise<User | undefined> {
    const [user] = await executor.select().from(users).where(eq(users.username, username)).limit(1);
    return user;
  }

  /**
   * Derives a free, valid username from an external handle (e.g. a GitHub login).
   * Tries the handle itself, then `-gh` and numbered suffixes, then a random suffix.
   */
  async findAvailableUsername(handle: string, executor: Executor = this.db): Promise<string> {
    const base =
      handle
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 32) || 'user';

    const candidates = [
      base,
      `${base}-gh`,
      ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`),
    ].filter((c) => USERNAME_PATTERN.test(c));

    if (candidates.length > 0) {
      const taken = await executor
        .select({ username: users.username })
        .from(users)
        .where(inArray(users.username, candidates));
      const takenSet = new Set(taken.map((t) => t.username));
      const free = candidates.find((c) => !takenSet.has(c));
      if (free) return free;
    }
    return `${base.slice(0, 30)}-${randomBytes(4).toString('hex')}`;
  }
}

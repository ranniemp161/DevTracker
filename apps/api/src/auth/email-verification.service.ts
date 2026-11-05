import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  emailVerificationTokens,
  users,
  type Database,
  type Executor,
  and,
  eq,
  gt,
  isNull,
} from '@devtrack/database';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import { MAILER, type Mailer } from '../mail/mailer';
import { verificationEmail } from '../mail/templates';
import { UsersService, type User } from '../users/users.service';
import { invalidToken } from './auth.errors';

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
  ) {}

  /** Creates a fresh token (invalidating earlier unused ones) and returns the raw value. */
  async issue(user: Pick<User, 'id' | 'email'>, executor: Executor = this.db): Promise<string> {
    await executor
      .delete(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.userId, user.id),
          isNull(emailVerificationTokens.consumedAt),
        ),
      );
    const token = generateToken();
    await executor.insert(emailVerificationTokens).values({
      userId: user.id,
      email: user.email,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    });
    return token;
  }

  /** Sends the email. Failures are logged, not thrown: the user can request a resend. */
  async deliver(user: Pick<User, 'email' | 'username'>, token: string): Promise<void> {
    try {
      await this.mailer.send(
        verificationEmail(user.email, user.username, this.config.webOrigin, token),
      );
    } catch (err) {
      this.logger.error(
        'Failed to send verification email',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async resend(user: User): Promise<void> {
    const token = await this.issue(user);
    await this.deliver(user, token);
  }

  /** Consumes the token atomically (single use) and marks the bound email verified. */
  async verify(token: string): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(emailVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, hashToken(token)),
            isNull(emailVerificationTokens.consumedAt),
            gt(emailVerificationTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!row) throw invalidToken();

      const user = await this.users.findById(row.userId, tx);
      // The token is bound to the address it was sent to.
      if (!user || user.email !== row.email) throw invalidToken();
      if (user.emailVerifiedAt) return user;

      const [updated] = await tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      return updated!;
    });
  }
}

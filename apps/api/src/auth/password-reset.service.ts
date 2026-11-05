import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  passwordResetTokens,
  users,
  type Database,
  and,
  eq,
  gt,
  isNull,
  sql,
} from '@devtrack/database';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import { MAILER, type Mailer } from '../mail/mailer';
import { passwordResetEmail } from '../mail/templates';
import { UsersService } from '../users/users.service';
import { invalidToken } from './auth.errors';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Emails a reset link if the account exists. Callers always respond the same way,
   * so the endpoint does not confirm which emails are registered.
   * OAuth-only accounts may use this to add a password (it proves email ownership).
   */
  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;

    const token = generateToken();
    await this.db.transaction(async (tx) => {
      await tx
        .delete(passwordResetTokens)
        .where(
          and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.consumedAt)),
        );
      await tx.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      });
    });

    try {
      await this.mailer.send(
        passwordResetEmail(user.email, user.username, this.config.webOrigin, token),
      );
    } catch (err) {
      this.logger.error(
        'Failed to send password reset email',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Consumes the token (single use), sets the new password, and revokes every session
   * for the account — a reset is often a response to compromise.
   */
  async reset(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.passwords.hash(newPassword);
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(token)),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!row) throw invalidToken();

      await tx
        .update(users)
        .set({
          passwordHash,
          // Following an emailed link proves ownership of the address.
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
        })
        .where(eq(users.id, row.userId));
      await this.sessions.revokeAllForUser(row.userId, tx);
      await tx
        .delete(passwordResetTokens)
        .where(
          and(eq(passwordResetTokens.userId, row.userId), isNull(passwordResetTokens.consumedAt)),
        );
    });
  }
}

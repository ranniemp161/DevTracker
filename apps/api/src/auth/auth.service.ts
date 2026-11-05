import { Inject, Injectable } from '@nestjs/common';
import { users, type Database, eq } from '@devtrack/database';
import type { LoginInput, RegisterInput } from '@devtrack/validators';
import { DATABASE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { UsersService, type User } from '../users/users.service';
import { emailTaken, invalidCredentials, usernameTaken } from './auth.errors';
import { EmailVerificationService } from './email-verification.service';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';

export interface SessionGrant {
  user: User;
  token: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly verification: EmailVerificationService,
  ) {}

  /** Creates the account, a session, and a verification token in one transaction. */
  async register(input: RegisterInput): Promise<SessionGrant> {
    // Friendly pre-checks; the unique constraints below remain the real guarantee.
    if (await this.users.findByEmail(input.email)) throw emailTaken();
    if (await this.users.findByUsername(input.username)) throw usernameTaken();

    const passwordHash = await this.passwords.hash(input.password);

    let result: SessionGrant & { verificationToken: string };
    try {
      result = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, username: input.username, passwordHash })
          .returning();
        const { token, expiresAt } = await this.sessions.create(user!.id, tx);
        const verificationToken = await this.verification.issue(user!, tx);
        return { user: user!, token, expiresAt, verificationToken };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_unique')) throw emailTaken();
      if (isUniqueViolation(err, 'users_username_unique')) throw usernameTaken();
      throw err;
    }

    await this.verification.deliver(result.user, result.verificationToken);
    return { user: result.user, token: result.token, expiresAt: result.expiresAt };
  }

  /** Email/password login. Unknown email and wrong password are indistinguishable. */
  async login(input: LoginInput): Promise<SessionGrant> {
    const user = await this.users.findByEmail(input.email);
    if (!user || !user.passwordHash) {
      await this.passwords.verifyDummy(input.password);
      throw invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw invalidCredentials();
    }

    if (this.passwords.needsRehash(user.passwordHash)) {
      const passwordHash = await this.passwords.hash(input.password);
      await this.db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    }

    const { token, expiresAt } = await this.sessions.create(user.id);
    return { user, token, expiresAt };
  }
}

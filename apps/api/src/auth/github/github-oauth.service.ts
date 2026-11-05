import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  accounts,
  oauthStates,
  users,
  type Database,
  type Executor,
  and,
  eq,
  lt,
} from '@devtrack/database';
import { ErrorCode } from '@devtrack/types';
import { emailSchema } from '@devtrack/validators';
import { AppException } from '../../common/errors/app.exception';
import { generateToken, hashToken, pkceChallenge, safeEqual } from '../../common/crypto/tokens';
import { APP_CONFIG, type AppConfig, type GithubOAuthConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import { isUniqueViolation } from '../../database/pg-errors';
import { UsersService, type User } from '../../users/users.service';
import { OAUTH_STATE_TTL_MS } from '../auth-cookies.service';
import { GithubOAuthClient, type GithubProfile } from './github-oauth.client';

/** Identity scopes only. Repository access comes from the GitHub App (M5), never from login. */
export const GITHUB_OAUTH_SCOPES = 'read:user user:email';

const oauthError = (status: HttpStatus, code: ErrorCode, message: string) =>
  new AppException(status, code, message);

const stateInvalid = () =>
  oauthError(
    HttpStatus.BAD_REQUEST,
    ErrorCode.OAUTH_STATE_INVALID,
    'Your GitHub sign-in session expired or is invalid. Please try again.',
  );

@Injectable()
export class GithubOAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly client: GithubOAuthClient,
    private readonly users: UsersService,
  ) {}

  private requireConfig(): GithubOAuthConfig {
    if (!this.config.github) {
      throw oauthError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.OAUTH_NOT_CONFIGURED,
        'GitHub sign-in is not configured.',
      );
    }
    return this.config.github;
  }

  /**
   * Starts the flow: stores the state hash + PKCE verifier server-side and returns the
   * GitHub authorize URL plus the raw state for the browser-binding cookie.
   */
  async begin(redirectTo: string): Promise<{ authorizeUrl: string; state: string }> {
    const github = this.requireConfig();

    // Opportunistic cleanup of abandoned flows (indexed on expires_at).
    await this.db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));

    const state = generateToken();
    const codeVerifier = generateToken(); // 43 chars: within RFC 7636's 43–128 range
    await this.db.insert(oauthStates).values({
      provider: 'github',
      stateHash: hashToken(state),
      codeVerifier,
      redirectTo,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', github.clientId);
    url.searchParams.set('redirect_uri', github.callbackUrl);
    url.searchParams.set('scope', GITHUB_OAUTH_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('allow_signup', 'true');
    return { authorizeUrl: url.toString(), state };
  }

  /**
   * Completes the flow. The query `state` must match the browser's cookie (login-CSRF
   * protection) and an unexpired server-side row, which is deleted on use (single use).
   */
  async complete(params: {
    code?: string;
    state?: string;
    providerError?: string;
    cookieState?: string;
  }): Promise<{ user: User; redirectTo: string }> {
    const github = this.requireConfig();
    const { code, state, cookieState } = params;

    if (!state || !cookieState || !safeEqual(state, cookieState)) throw stateInvalid();

    const [row] = await this.db
      .delete(oauthStates)
      .where(and(eq(oauthStates.stateHash, hashToken(state)), eq(oauthStates.provider, 'github')))
      .returning();
    if (!row || row.expiresAt.getTime() <= Date.now()) throw stateInvalid();

    if (params.providerError || !code) {
      throw oauthError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.OAUTH_PROVIDER_ERROR,
        'GitHub sign-in was cancelled or failed.',
      );
    }

    const accessToken = await this.client.exchangeCode({
      clientId: github.clientId,
      clientSecret: github.clientSecret,
      code,
      redirectUri: github.callbackUrl,
      codeVerifier: row.codeVerifier,
    });
    const profile = await this.client.fetchProfile(accessToken);
    const user = await this.resolveUser(profile, () =>
      this.client.fetchPrimaryVerifiedEmail(accessToken),
    );
    return { user, redirectTo: row.redirectTo };
  }

  /**
   * Account-linking policy (decision record 0001):
   * 1. A linked GitHub identity signs in its user.
   * 2. Otherwise GitHub must supply a verified primary email.
   * 3. If a DevTrack account has that email, link only when the DevTrack email is also
   *    verified. An unverified account could have been pre-registered by an attacker
   *    who does not own the address ("pre-hijacking"), so we refuse instead.
   * 4. Otherwise create a new, already-verified account.
   */
  private async resolveUser(
    profile: GithubProfile,
    getVerifiedEmail: () => Promise<string | null>,
  ): Promise<User> {
    const providerAccountId = String(profile.id);
    const linked = await this.findLinkedUser(providerAccountId);
    if (linked) return linked;

    const rawEmail = await getVerifiedEmail();
    const parsedEmail = emailSchema.safeParse(rawEmail);
    if (!rawEmail || !parsedEmail.success) {
      throw oauthError(
        HttpStatus.FORBIDDEN,
        ErrorCode.OAUTH_EMAIL_UNVERIFIED,
        'Your GitHub account needs a verified primary email address to sign in.',
      );
    }
    const email = parsedEmail.data;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.db.transaction((tx) =>
          this.linkOrCreate(tx, profile, providerAccountId, email),
        );
      } catch (err) {
        // Concurrent first sign-in with the same GitHub identity: the other request won.
        if (isUniqueViolation(err, 'accounts_provider_account_unique')) {
          const winner = await this.findLinkedUser(providerAccountId);
          if (winner) return winner;
        }
        // Username raced with another signup: retry once with a fresh candidate.
        if (isUniqueViolation(err, 'users_username_unique') && attempt === 0) continue;
        throw err;
      }
    }
    throw new Error('unreachable');
  }

  private async linkOrCreate(
    tx: Executor,
    profile: GithubProfile,
    providerAccountId: string,
    email: string,
  ): Promise<User> {
    const existing = await this.users.findByEmail(email, tx);
    if (existing) {
      if (!existing.emailVerifiedAt) throw linkRequired();
      try {
        await tx
          .insert(accounts)
          .values({ userId: existing.id, provider: 'github', providerAccountId });
      } catch (err) {
        // The account already has a *different* GitHub identity linked.
        if (isUniqueViolation(err, 'accounts_user_provider_unique')) throw linkRequired();
        throw err;
      }
      if (!existing.avatarUrl && profile.avatarUrl) {
        const [updated] = await tx
          .update(users)
          .set({ avatarUrl: profile.avatarUrl })
          .where(eq(users.id, existing.id))
          .returning();
        return updated!;
      }
      return existing;
    }

    const username = await this.users.findAvailableUsername(profile.login, tx);
    const [created] = await tx
      .insert(users)
      .values({
        email,
        username,
        passwordHash: null,
        emailVerifiedAt: new Date(), // GitHub verified this address
        avatarUrl: profile.avatarUrl,
      })
      .returning();
    await tx
      .insert(accounts)
      .values({ userId: created!.id, provider: 'github', providerAccountId });
    return created!;
  }

  private async findLinkedUser(providerAccountId: string): Promise<User | undefined> {
    const [row] = await this.db
      .select({ user: users })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(
        and(eq(accounts.provider, 'github'), eq(accounts.providerAccountId, providerAccountId)),
      )
      .limit(1);
    return row?.user;
  }
}

const linkRequired = () =>
  oauthError(
    HttpStatus.CONFLICT,
    ErrorCode.OAUTH_ACCOUNT_LINK_REQUIRED,
    'An account with this email already exists. Sign in with your password and verify your email, then try GitHub sign-in again.',
  );

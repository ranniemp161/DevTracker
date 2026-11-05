import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const authProvider = pgEnum('auth_provider', ['github']);

/** Architecture §5 — users. Email and username are stored normalized (lower-case). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    /** Argon2id PHC string. Null for accounts created through GitHub OAuth only. */
    passwordHash: text('password_hash'),
    emailVerifiedAt: timestamptz('email_verified_at'),
    avatarUrl: text('avatar_url'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('users_email_unique').on(t.email),
    unique('users_username_unique').on(t.username),
    check('users_email_normalized', sql`${t.email} = lower(${t.email})`),
    check('users_username_normalized', sql`${t.username} = lower(${t.username})`),
  ],
);

/** Architecture §5 — external identities linked to a user (GitHub OAuth login). */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider('provider').notNull(),
    /** Stable numeric provider ID as text (GitHub logins can be renamed; IDs cannot). */
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('accounts_provider_account_unique').on(t.provider, t.providerAccountId),
    // One identity per provider per user.
    unique('accounts_user_provider_unique').on(t.userId, t.provider),
  ],
);

/** Architecture §5 — sessions. Only the SHA-256 hash of the session token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * M1 addition (approved): single-use email verification tokens.
 * `email` binds the token to the address it was sent to, so a later email change
 * cannot be verified with an old link.
 */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('email_verification_tokens_token_hash_unique').on(t.tokenHash),
    index('email_verification_tokens_user_id_idx').on(t.userId),
  ],
);

/** M1 addition (approved): single-use password reset tokens. */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('password_reset_tokens_token_hash_unique').on(t.tokenHash),
    index('password_reset_tokens_user_id_idx').on(t.userId),
  ],
);

/**
 * M1 addition (approved): OAuth `state` for login flows. The raw state also lives in an
 * HTTP-only cookie, binding the flow to the browser that started it (login-CSRF protection).
 * Rows are deleted when consumed, which makes them single-use.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: authProvider('provider').notNull(),
    stateHash: text('state_hash').notNull(),
    /** PKCE verifier; short-lived and deleted on use. */
    codeVerifier: text('code_verifier').notNull(),
    redirectTo: text('redirect_to').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('oauth_states_state_hash_unique').on(t.stateHash),
    index('oauth_states_expires_at_idx').on(t.expiresAt),
  ],
);

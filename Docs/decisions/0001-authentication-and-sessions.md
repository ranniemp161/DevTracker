# 0001 — Authentication, sessions and M1 foundation choices

- **Status:** Accepted (M1)
- **Date:** 2026-11-06
- **Resolves:** Open decision #4 (session implementation) in `DEVTRACK_ARCHITECTURE.md` §20
- **Scope:** Milestone M1 — monorepo, database, migrations, authentication

## 1. Sessions: opaque, database-backed tokens (no session library)

- A session token is 32 random bytes, base64url (256 bits).
- The browser holds the token in an HTTP-only cookie. The `sessions` table stores only its SHA-256 hash (§5: "store session token hashes").
- Lifetime is a fixed 30 days (no sliding expiration yet). Every request checks the session with one indexed lookup that joins `sessions` and `users`.
- Revocation means deleting the row:
  - Logout deletes the current session.
  - Login and registration delete the browser's previous session, so a pre-set cookie can't survive sign-in.
  - Password reset deletes every session for the account.
- **Why not JWTs or a session library:** opaque tokens can be revoked immediately, don't need a signing key, and work on serverless because state lives in Postgres rather than process memory. The schema in §5 already describes this model.

**Cookie policy:** `HttpOnly; SameSite=Lax; Path=/`. When the site is served over HTTPS, the cookie is also `Secure` and uses the `__Host-` name prefix (`__Host-devtrack_session`). Browsers only accept a `__Host-` cookie if it is Secure, has no Domain and has Path=/, so a sibling subdomain cannot plant or overwrite it.

## 2. The browser reaches the API same-origin, through the website

The website rewrites `/api/v1/*` to the NestJS API (`API_INTERNAL_URL`), and the browser only ever talks to the website origin.

- **Why:** session cookies become first-party, so `SameSite=Lax` works. This holds even when the website and API run on different hosts, such as two `*.vercel.app` deployments. `vercel.app` is on the Public Suffix List, so those two hosts would count as cross-site and Lax cookies would not be sent.
- The GitHub OAuth callback URL is also on the website origin (`/api/v1/auth/github/callback`).
- CORS stays restricted to `WEB_ORIGIN` as defence in depth.
- **To validate in M8:** the exact Vercel setup (rewrite target and client IP forwarding), alongside the Vercel WebSocket validation (open decision #3).

## 3. CSRF defence

- **Layer 1:** `SameSite=Lax` cookies.
- **Layer 2:** a global `OriginGuard` checks state-changing methods.
  - A request whose `Origin` header differs from `WEB_ORIGIN` is rejected with `403 CSRF_REJECTED`.
  - A request without `Origin` is also rejected if `Sec-Fetch-Site: cross-site`.
  - A request with neither header (curl, server-to-server, and later GitHub webhooks) passes through to normal authentication. It carries no ambient browser cookies from a hostile page.

## 4. Passwords

- Passwords are hashed with Argon2id at OWASP's minimum parameters: m=19456 KiB, t=2, p=1 (`@node-rs/argon2`, which ships prebuilt binaries with no install script).
- On successful login, a hash made with different parameters is re-hashed automatically.
- Login runs a dummy Argon2 verification when the email is unknown, so response timing doesn't reveal which emails are registered. Login also returns the same error for an unknown email and a wrong password.
- The length policy follows NIST SP 800-63B: 8–128 characters, with no composition rules.

## 5. Email verification and password reset

- Both use 256-bit, single-use tokens. Only the SHA-256 hash is stored.
- A token is consumed by an atomic `UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING`.
- Issuing a new token deletes the user's earlier unused tokens.
- **Links carry the token in the URL fragment** (`/verify-email#token=…`). The browser never sends a fragment to a server, so tokens stay out of access logs and `Referer` headers. The page reads the token, removes it from the address bar, and POSTs it to the API.
- **Verification:** the link is valid for 24 hours. The token is bound to the email address it was sent to.
  - **Verified email is required by default.** Every authenticated route requires a verified email unless it is marked `@AllowUnverified()`. Today that applies to `/auth/me` and `/auth/resend-verification`. This implements §5's "Email verification before protected workspace use" as secure-by-default.
- **Password reset:** the link is valid for 1 hour.
  - A reset revokes every session for the account.
  - A reset marks the email as verified, because following the link proves the user owns the address.
  - `forgot-password` always answers `202` with the same body, whether or not the email exists.

## 6. GitHub OAuth login (identity only, separate from the GitHub App)

- **Scopes:** `read:user user:email` only. Repository access comes from the GitHub App (M5), never from login (§2).
- **Code exchange:** the GitHub access token is used only to read the profile and verified emails, then discarded. It is never stored.
- **State:** a random `state` value is stored in two places:
  - as a hash in `oauth_states`, with a 10-minute expiry;
  - raw in an HTTP-only `SameSite=Lax` cookie, which binds the flow to the browser that started it (login-CSRF protection).

  On callback, the query value must match the cookie, and the database row is deleted as it is used, which makes it single-use.
- **PKCE (S256)** is used in addition to `state`. The verifier is stored on the `oauth_states` row and deleted with it.
- `redirectTo` must be a same-site relative path (`safeRedirectPath`), which prevents open redirects.
- **Account-linking policy** (§5, "prevent account-linking vulnerabilities"):
  1. If the GitHub user ID (a stable numeric ID) is already linked, sign in that user.
  2. Otherwise, require a primary GitHub email that GitHub has verified. If there is none, return `OAUTH_EMAIL_UNVERIFIED`.
  3. If a DevTrack account already has that email, link GitHub only if the DevTrack email is also verified. Otherwise return `OAUTH_ACCOUNT_LINK_REQUIRED`. This blocks pre-hijacking, where an attacker registers someone else's email and waits for the real owner to sign in with GitHub.
  4. Otherwise create a new account. Its email counts as verified (GitHub verified it) and it has no password. The username comes from the GitHub login, with a suffix if that name is taken.
- Callback errors redirect to `/login?error=<CODE>`. The website shows a readable message for each code.

## 7. Rate limiting is stored in PostgreSQL

Serverless instances share no memory, so counters live in the `rate_limit_buckets` table. Each check is a fixed-window counter updated with one atomic upsert. Keys are SHA-256 hashed, so emails and IP addresses are not stored in plaintext. Limits are defined centrally in `apps/api/src/rate-limit/rate-limit.service.ts`:

| Action | Limit |
|---|---|
| Register | 20/hour per IP |
| Login | 100/15 min per IP and 10/15 min per IP+email |
| Forgot password | 3/hour per email and 20/hour per IP |
| Resend verification | 5/hour per user |
| Redeem a token (verify/reset) | 30/15 min per IP |

The per-IP limits are generous because a team may share one office IP address. Redis was the alternative (§3 allows "justified short-lived coordination"). Postgres avoids adding a dependency in M1; this can be revisited when Redis arrives in M7.

## 8. Schema and API additions approved for M1

**Tables:**

| Table | Purpose |
|---|---|
| `email_verification_tokens` | Email verification tokens |
| `password_reset_tokens` | Password reset tokens |
| `oauth_states` | OAuth state and PKCE verifier |
| `rate_limit_buckets` | Rate-limit counters |

**Endpoints:**

| Endpoint | Purpose |
|---|---|
| `POST /auth/resend-verification` | Without it, an expired verification link would be a dead end. |
| `GET /health` | Database-backed health check for deployments. |

**Error envelope:** `error.details[]` (`{ path, message }`) is added as an optional field, present only for `VALIDATION_ERROR`. Framework and parser errors return a fixed generic message per status so internals never leak.

**Constraints:**

- `users.email` and `users.username` are stored lower-case, enforced by CHECK constraints.
- Usernames are 2–39 characters, the same as GitHub's maximum.
- An account can link at most one identity per provider (`accounts_user_provider_unique`).

## 9. Email delivery

Mail goes through a `Mailer` interface (`MAILER` token). M1 ships only a console transport, which prints emails to the API log for development. Configuration validation **refuses to start in production** while the console transport is selected, so a provider must be chosen first (open decision #1).

## 10. Toolchain notes

- **TypeScript 6.0:** NestJS CLI 12 pins `~6.0`, and typescript-eslint supports `<6.1`. TypeScript 7 (the native compiler) can be revisited once Nest supports it.
- **NestJS 12 is ESM-only.** The API follows the official Nest 12 template: a CommonJS-mode app that loads Nest through `require(esm)`. Shared packages are ESM.
- **Single drizzle-orm instance:** `@devtrack/database` re-exports the query operators (`eq`, `and`, `sql`, …). The API imports them from there and never from `drizzle-orm` directly. This avoids a dual-package type conflict (CommonJS and ESM declarations of the same types) and keeps database access behind one package boundary (§12).
- **Database driver:** `node-postgres` against Neon's pooled connection string. The Neon HTTP driver was not used because outbox writes and task-number allocation need interactive transactions.
- **Tests:** integration tests run against PGlite, an in-memory Postgres, with the real migrations applied (`@devtrack/database/testing`). No external database is needed for tests.
- **pnpm 12 policies:**
  - Only `esbuild` may run install scripts. The `@swc/core` script is explicitly denied; its binary ships as an optional dependency.
  - `@swc/core` is pinned to 1.16.21 so the lockfile passes pnpm's minimum-release-age check without any exemption.

## Known limitations and follow-ups

- **Account enumeration:** registration returns `EMAIL_TAKEN`/`USERNAME_TAKEN`, and the "forgot password" response time can differ slightly between known and unknown emails. Both are rate-limited and accepted for an internal product.
- **Cleanup:** expired `sessions`, used or expired tokens, and old `rate_limit_buckets` rows are not purged yet. Abandoned `oauth_states` rows are removed opportunistically. A scheduled cleanup job belongs with M8 deployment work.
- **No settings flow yet:** there is no "link GitHub from account settings" flow. Linking happens through the verified-email policy above.
- **Not yet verified:** a real GitHub OAuth app round-trip, real email delivery, and Vercel behaviour (proxy, `TRUST_PROXY`, client IPs) still need checking. GitHub calls are faked in tests.

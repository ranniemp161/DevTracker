# 0008 — Release readiness: email, error tracking, retention, client IP, operations

- **Status:** Accepted (M8)
- **Date:** 2026-11-07
- **Scope:** Milestone M8 — architecture §14, §15, §16, §17, §19
- **Records:** Open decisions #1 (email provider), #4 (Vercel proxy and client IP), #7 (retention)

Rules 1–3 were approved before implementation (§21 rule 12).

## 1. Email: Resend (approved; open decision #1)

- `MAIL_TRANSPORT=resend` with `RESEND_API_KEY`. `MAIL_FROM` must use a domain verified in Resend.
- Production refuses `console`. That transport prints one-time links to the log and stays development-only.
- Send failures throw an error without the message body (it holds tokens). Callers already log the failure and let the user request the email again.

## 2. Error tracking: Sentry (approved)

- **API:** `@sentry/node`, enabled by `SENTRY_DSN`. **Website:** `@sentry/nextjs`, enabled by `NEXT_PUBLIC_SENTRY_DSN`. Both are off when the DSN is unset.
- **Errors only:** `tracesSampleRate: 0`. Latency and error-rate metrics come from Vercel's built-in observability.
- **No personal data:** `dataCollection` turns off user info, cookies, bodies and query strings, and denies `authorization`, `cookie`, `set-cookie` and `x-hub-signature-256`. A `beforeSend` scrubber removes the same data again as a second line of defence; this is unit-tested. The website also strips `?query` and `#fragment` from event URLs and breadcrumbs, because verification and invitation links carry `#token=…`.
- **What is reported:**
  - unexpected HTTP 500s (tagged with request ID, method, route and status);
  - unhandled WebSocket errors;
  - failed webhook processing (delivery ID, event and attempt);
  - failed outbox flushes;
  - website render and request errors.
- **Release and environment:** taken from `VERCEL_GIT_COMMIT_SHA` and `VERCEL_ENV` when available.

## 3. Retention (approved; open decision #7)

`GET /internal/maintenance/prune` (Bearer `CRON_SECRET`) runs daily at 03:17 UTC from GitHub Actions:

| Data                                                       | Kept for                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Webhook delivery records                                   | 30 days (payloads are already cleared once processed, M6) |
| Published outbox events                                    | 7 days (unpublished rows are never pruned)                |
| Read notifications                                         | 90 days (unread ones are kept)                            |
| Sessions, email/reset tokens, OAuth and install states     | Removed once expired                                      |
| Rate-limit buckets                                         | 2 days (the longest window is 1 day)                      |
| Activity, tasks, comments, pull requests, commits, reviews | Kept: product history                                     |

## 4. Client IP behind the website proxy (open decision #4)

- The browser reaches the API only through the website's `/api/v1` rewrite. Vercel **overwrites `X-Forwarded-For`** when one deployment proxies to another, so the API would see the website's IP for every user. All users would then share the per-IP rate limits for login, registration and password reset.
- **The fix:**
  1. The website's `src/proxy.ts` (Next.js 16 "Proxy") discards any client-sent `x-devtrack-*` headers.
  2. It sets `x-devtrack-client-ip` from the first `X-Forwarded-For` entry. On Vercel that entry is the client, set by the edge, and can't be spoofed.
  3. It adds `x-devtrack-proxy-secret`.
  4. The API trusts the forwarded IP **only** when the secret matches `WEB_PROXY_SECRET` (constant-time) and the value is a valid IP. Otherwise it uses Express's `req.ip`.
- `WEB_PROXY_SECRET` (32+ characters, the same value in both projects) is required in production.
- **Tests:** a unit test, and an end-to-end test proving that forwarded clients get separate rate limits and that spoofed headers without the secret are ignored.

## 5. Operations and monitoring (§15)

- **`GET /internal/status`** (Bearer `CRON_SECRET`) reports:
  - the number of unpublished outbox events, and the oldest one;
  - webhook deliveries: failed, retryable and pending;
  - `exhaustedLast24h`: deliveries that failed every retry in the last 24 hours.
- **`.github/workflows/scheduled-jobs.yml`** runs every 10 minutes. It retries webhooks, flushes the outbox, then runs a **health check**, which fails the run when:
  - an outbox event has been unpublished for more than 30 minutes, or
  - any delivery exhausted its retries in the last 24 hours.

  GitHub emails the repository owner about failed runs, which is the alert. The daily schedule runs the retention cleanup.

- **Existing since M1:** structured JSON logs in production, and request IDs (`x-request-id`) on every response and error.

## 6. Security review (§14, §16)

| Check                                            | Result                                                                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-workspace project access by guessed ID     | 404 everywhere. Covered since M2/M3 tests                                                                                                                                     |
| Modifying another user's task without permission | 403/404. M3 tests                                                                                                                                                             |
| Joining an unauthorized WebSocket room           | `NOT_FOUND` / `INVALID_ROOM`. M7 tests and the journey test                                                                                                                   |
| Invitation token replay                          | Single use. M2 tests                                                                                                                                                          |
| Invalid or tampered webhook signature            | 401. M6 tests, including GitHub's published test vector                                                                                                                       |
| Duplicate webhook delivery                       | Acknowledged and not reapplied. M6 tests                                                                                                                                      |
| OAuth / GitHub install state mismatch            | Rejected. M1/M5 tests                                                                                                                                                         |
| Activity of a repository that isn't selected     | Its events are ignored, and its PRs are visible only through connected projects. M6 tests                                                                                     |
| Rate limiting behind the proxy                   | Per real client (rule 4)                                                                                                                                                      |
| Secrets in logs, Sentry or activity              | None. Tests check activity/outbox payloads and Sentry scrubbing                                                                                                               |
| Dependencies (`pnpm audit --prod`)               | 1 moderate: `minimatch` (GHSA-g3hv-75wg-m249), reached only through ESLint tooling, never at runtime. **Accepted.** ESLint 10 needs minimatch 10; revisit when ESLint updates |

## 7. Hosting and deployment

- **Two Vercel projects on Hobby**, from one repository:
  - `devtrack-website` (Root Directory `apps/website`, Next.js);
  - `devtrack-api` (Root Directory `apps/api`). Vercel runs `apps/api/server.mjs` as one function. It loads `dist/vercel/server.mjs`: after `nest build`, `scripts/build-esm.mjs` compiles the API to ES modules with SWC (keeping decorator metadata) and bundles it with the `@devtrack/*` packages into that single `.mjs` file with esbuild; third-party packages stay imports from `node_modules`. Reasons, found one deploy at a time: Vercel's runtime cannot `require()` ES-module-only NestJS 12; its packager rewrites our own ES-module `.js` files (including the pnpm-linked workspace packages) to CommonJS, breaking them; `.mjs` files it leaves alone. Two problems forced this: Vercel re-type-checked the TypeScript with its own, different settings and failed on code that passes CI; and NestJS 12 is ES-module-only, which Vercel's runtime cannot `require()` from the CommonJS `nest build` output (`ERR_REQUIRE_ESM`, reproduced locally with `node --no-experimental-require-module`). `src/main.ts` is now `src/bootstrap.ts`, so Vercel no longer auto-detects the TypeScript entry; type-checking stays with `nest build` and CI.

  Steps are in `Docs/deploy-runbook.md`.

- The API honours the platform `PORT` when `API_PORT` isn't set.
- Migrations are applied **before** each deploy that needs them (`pnpm db:migrate` against the production database). They never run inside a function.
- Still to confirm on the first deploy (0007): a Nest Socket.IO gateway on Vercel, and the client-IP forwarding in rule 4 (`/internal/status` and API logs show it).

## 8. Acceptance

`Docs/release-checklist.md` maps each §17 criterion to its automated evidence and to the manual production checks still needed. `test/journey.e2e-spec.ts` runs the §16 end-to-end scenario (steps 1–14) through HTTP, signed webhooks and a real Socket.IO client.

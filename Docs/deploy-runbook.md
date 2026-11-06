# DevTrack deploy runbook (Vercel Hobby)

For whoever deploys DevTrack. Rules and rationale are in `Docs/decisions/0007-realtime.md` and `0008-release-readiness.md`. Do the steps in order; each one says how to check it worked.

## 0. Accounts and resources (one-time)

| What                | Where                                                                           | You'll get                                                                   |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Production database | Neon: create a branch (or project) named `production`                           | Its **pooled** connection string (`-pooler` host, `sslmode=require`)         |
| Redis               | Vercel Marketplace → Upstash Redis (free tier), connected to the API project    | `REDIS_URL` (`rediss://…`)                                                   |
| Email               | resend.com: add and verify your sending domain (DNS records)                    | `RESEND_API_KEY`, and a `MAIL_FROM` such as `DevTrack <no-reply@yourdomain>` |
| Errors              | sentry.io: two projects, _devtrack-api_ (Node) and _devtrack-website_ (Next.js) | Two DSNs                                                                     |
| GitHub sign-in      | A new **OAuth App** for production                                              | Client ID and secret                                                         |
| GitHub App          | A **separate production GitHub App**. Settings as in 0005 §8 and 0006 §9        | App ID, slug, client ID and secret, private key, webhook secret              |

Generate the shared secrets locally, each a different value, and keep them in a password manager:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You need four: `REALTIME_SECRET`, `WEB_PROXY_SECRET`, `CRON_SECRET` and `GITHUB_APP_WEBHOOK_SECRET`.

## 1. Create the two Vercel projects

From the repository root:

```bash
vercel link --repo
```

Create **devtrack-api** (Root Directory `apps/api`) and **devtrack-website** (Root Directory `apps/website`). Keep the defaults: Vercel runs `turbo run build` for each. The API entry is `apps/api/server.mjs` (it loads `dist/vercel/server.mjs`, a single bundled ES module; see 0008 §7), and the website is detected as Next.js. Node 24 or newer is used, from `engines` in `package.json`.

**Check:** both projects appear in the Vercel dashboard, linked to the GitHub repository.

## 2. Environment variables

Set these for **Production** in each project (Settings → Environment Variables, or `vercel env add NAME production`). The URLs below are the projects' `*.vercel.app` domains; use custom domains if you have them.

### devtrack-api

| Variable                                                                                                             | Value                                         |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`                                                                                                       | Neon production pooled URL                    |
| `WEB_ORIGIN`                                                                                                         | `https://devtrack-website.vercel.app`         |
| `TRUST_PROXY`                                                                                                        | `1`                                           |
| `MAIL_TRANSPORT` / `RESEND_API_KEY` / `MAIL_FROM`                                                                    | `resend` / key / sender                       |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`                                                              | Production OAuth App                          |
| `GITHUB_APP_ID` / `GITHUB_APP_SLUG` / `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` / `GITHUB_APP_PRIVATE_KEY` | Production GitHub App (private key as base64) |
| `GITHUB_APP_WEBHOOK_SECRET`                                                                                          | Generated                                     |
| `CRON_SECRET` / `REALTIME_SECRET` / `WEB_PROXY_SECRET`                                                               | Generated                                     |
| `REDIS_URL`                                                                                                          | Upstash                                       |
| `SENTRY_DSN`                                                                                                         | API DSN                                       |

### devtrack-website

| Variable                   | Value                             |
| -------------------------- | --------------------------------- |
| `API_INTERNAL_URL`         | `https://devtrack-api.vercel.app` |
| `NEXT_PUBLIC_REALTIME_URL` | `https://devtrack-api.vercel.app` |
| `WEB_PROXY_SECRET`         | **The same value** as the API's   |
| `NEXT_PUBLIC_SENTRY_DSN`   | Website DSN                       |

The API refuses to start in production if a required value is missing or malformed, and its log lists every problem.

## 3. Migrate the production database

```bash
DATABASE_URL="<neon production pooled url>" pnpm db:migrate
```

**Check:** it ends with `migrations applied successfully`. Run this before every deploy that adds a migration.

## 4. Deploy

```bash
vercel deploy --prod --cwd apps/api
vercel deploy --prod --cwd apps/website
```

**Check:**

- `https://devtrack-api.vercel.app/api/v1/health` returns 200.
- The website loads, and you can register. The verification email arrives through Resend.
- In DevTools → Network → WS, `…/api/v1/realtime/socket` shows **101** and stays open. **This confirms the Nest gateway works on Vercel (0007).** If it fails, stop and report it: the fallback in 0007 applies.

## 5. GitHub App URLs (production app)

- **Callback URL:** `https://devtrack-website.vercel.app/api/v1/github/install/callback`
- **Webhook URL:** `https://devtrack-api.vercel.app/api/v1/webhooks/github`. Use the API directly, not through the website proxy: the signature is computed over the exact bytes, and the extra hop isn't needed.
- **Webhook secret:** `GITHUB_APP_WEBHOOK_SECRET`. Events: Push, Pull request, Pull request review, Release.
- **OAuth App callback:** `https://devtrack-website.vercel.app/api/v1/auth/github/callback`

**Check:** Recent Deliveries on the App shows the ping, and `GET /api/v1/internal/status` (with `CRON_SECRET`) shows no failures.

## 6. Scheduled jobs (GitHub Actions)

In the repository's Settings → Secrets and variables → Actions:

- variable `API_URL` = `https://devtrack-api.vercel.app`
- secret `CRON_SECRET` = the API's value

Then run **Scheduled jobs** once by hand (Actions → Scheduled jobs → Run workflow).

**Check:** it's green. From then on it runs every 10 minutes, with cleanup daily, and GitHub emails you if the health check fails.

## 7. Production acceptance

Work through the "production checks" column of `Docs/release-checklist.md`. Confirm the client IP is forwarded: sign in from two networks (e.g. Wi-Fi and phone hotspot) and check the API logs show different addresses.

## Rollback

Each Vercel project keeps its previous deployments. Use **Instant Rollback** (Deployments → … → Promote), or `vercel rollback --cwd apps/<app>`. Migrations only add things and aren't rolled back. A release that needs a destructive migration must say so in its PR.

# DevTrack

DevTrack is an internal engineering project management platform with first-class GitHub integration.

- **Architecture reference:** [DEVTRACK_ARCHITECTURE.md](DEVTRACK_ARCHITECTURE.md)
- **Decision records:** [Docs/decisions/](Docs/decisions/)

**Status:** M1–M6 are merged. M7 (real-time updates) is on the `m7-realtime` branch.

## Repository layout

```text
apps/
  api/          NestJS 12 REST API (/api/v1), modular monolith
  website/      Next.js 16 frontend (proxies /api/v1 to the API)
packages/
  database/     Drizzle schema, SQL migrations, client, PGlite test helper
  types/        Shared API contracts (envelopes, error codes, PublicUser)
  validators/   Shared Zod schemas, used by both API and website
  config/       Shared TypeScript configurations
  eslint-config/
```

## Prerequisites

- Node.js 24 or newer (developed on 26)
- pnpm 12
- A Neon PostgreSQL database. Use the **pooled** connection string.

## Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy `.env.example` to `.env` in the repository root, then set `DATABASE_URL`. `.env` is git-ignored.

   ```bash
   cp .env.example .env
   ```

3. Apply the migrations to Neon:

   ```bash
   pnpm db:migrate
   ```

4. Start everything. Turborepo builds the shared packages first, then runs both apps:

   ```bash
   pnpm dev
   ```

   - Website: http://localhost:3000
   - API: http://localhost:4000/api/v1/health

In development, emails (verification and password reset) are printed to the API terminal. Open the printed link to continue.

### GitHub sign-in (optional in development)

1. Create an **OAuth App**, not a GitHub App, at <https://github.com/settings/developers>.
2. Set its authorization callback URL to `http://localhost:3000/api/v1/auth/github/callback`.
3. Set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` in `.env`.

The DevTrack GitHub App, which grants repository access, is set up separately (below).

### GitHub App and webhooks (optional in development)

Repository access and GitHub activity come from a **GitHub App**, not from sign-in. Full settings are in [0005](Docs/decisions/0005-github-app-setup.md) §8 and [0006](Docs/decisions/0006-github-events.md) §9.

1. Create a GitHub App at <https://github.com/settings/apps/new>.
   - **Callback URL:** `http://localhost:3000/api/v1/github/install/callback`
   - Turn on **Request user authorization (OAuth) during installation**.
   - **Repository permissions** (all read-only): Metadata, Contents, Pull requests.
   - **Events:** Push, Pull request, Pull request review, Release.
2. GitHub can't reach `localhost`, so forward webhooks through a channel:
   - Create one at <https://smee.io>.
   - Set it as the app's **Webhook URL**, with a random **Webhook secret**.
   - Run `npx smee-client --url https://smee.io/<channel> --target http://localhost:4000/api/v1/webhooks/github`.
3. Set these in `.env`:
   - `GITHUB_APP_ID`
   - `GITHUB_APP_SLUG`
   - `GITHUB_APP_CLIENT_ID`
   - `GITHUB_APP_CLIENT_SECRET`
   - `GITHUB_APP_PRIVATE_KEY` (the downloaded `.pem`, or its base64)
   - `GITHUB_APP_WEBHOOK_SECRET`
4. Optionally set `CRON_SECRET` to enable `GET /api/v1/internal/github/deliveries/retry`, which retries failed deliveries.

Admins install the app from **Workspace settings → GitHub** and connect repositories from **Project settings → Repositories**. Pull requests whose branch or title contains a task key (e.g. `feature/dev-12-login`) are linked to that task automatically.

## Common commands

| Command                          | Purpose                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm build`                     | Build all packages and apps                                                                          |
| `pnpm test`                      | Unit and integration tests. They use in-memory Postgres (PGlite), so no external database is needed. |
| `pnpm lint` / `pnpm typecheck`   | Static checks                                                                                        |
| `pnpm db:generate --name <name>` | Generate a migration after changing `packages/database/src/schema`                                   |
| `pnpm db:migrate`                | Apply migrations to `DATABASE_URL`                                                                   |

## Authentication API (M1)

All paths are under `/api/v1`. Full rationale: [Docs/decisions/0001-authentication-and-sessions.md](Docs/decisions/0001-authentication-and-sessions.md).

| Method | Endpoint                    | Auth    | Notes                                                                |
| ------ | --------------------------- | ------- | -------------------------------------------------------------------- |
| POST   | `/auth/register`            | public  | Creates the account, starts a session and emails a verification link |
| POST   | `/auth/login`               | public  | Email and password; rate-limited                                     |
| POST   | `/auth/logout`              | public  | Revokes the current session and clears the cookie                    |
| GET    | `/auth/me`                  | session | Current user, verified or not                                        |
| POST   | `/auth/verify-email`        | public  | `{ token }` from the emailed link                                    |
| POST   | `/auth/resend-verification` | session | Only while the email is unverified                                   |
| POST   | `/auth/forgot-password`     | public  | Always `202`                                                         |
| POST   | `/auth/reset-password`      | public  | `{ token, password }`; revokes all sessions                          |
| GET    | `/auth/github`              | public  | Browser redirect to GitHub (`?redirectTo=/path`)                     |
| GET    | `/auth/github/callback`     | public  | Redirect target registered with GitHub                               |
| GET    | `/health`                   | public  | Checks database connectivity                                         |

Responses use the envelope from §9 of the architecture doc: `{ data, meta: { requestId } }` on success and `{ error: { code, message, requestId, details? } }` on failure. Unless a route is marked public, it needs a session and a **verified email**.

## Workspaces API (M2)

All routes need a session and a verified email. Non-members get `404` for every workspace resource. Rules: [Docs/decisions/0002-workspaces-membership-invitations.md](Docs/decisions/0002-workspaces-membership-invitations.md).

| Method | Endpoint                          | Who                                                                       |
| ------ | --------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/workspaces`                     | Any verified user (becomes Owner)                                         |
| GET    | `/workspaces`                     | Your active workspaces, with your role                                    |
| GET    | `/workspaces/:id`                 | Members                                                                   |
| PATCH  | `/workspaces/:id`                 | Admin, Owner (rename)                                                     |
| DELETE | `/workspaces/:id`                 | Owner (archives)                                                          |
| GET    | `/workspaces/:id/members`         | Members                                                                   |
| PATCH  | `/workspaces/:id/members/:userId` | Owner; Admin for Members only                                             |
| DELETE | `/workspaces/:id/members/:userId` | Owner; Admin for Members only; anyone but the Owner can remove themselves |
| POST   | `/workspaces/:id/invitations`     | Admin, Owner                                                              |
| GET    | `/workspaces/:id/invitations`     | Admin, Owner (open invitations)                                           |
| POST   | `/invitations/accept`             | The invited email's account                                               |
| POST   | `/invitations/:id/revoke`         | Admin, Owner of that workspace                                            |

## Projects and tasks API (M3)

Owners and Admins can access every project in their workspace; Members only the projects they belong to. Everyone else gets `404`. Rules: [Docs/decisions/0003-projects-and-tasks.md](Docs/decisions/0003-projects-and-tasks.md).

| Method               | Endpoint                                               | Who                                                                                |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| POST / GET           | `/workspaces/:id/projects`                             | Create: Admin, Owner. List: members (`?includeArchived=true`)                      |
| GET / PATCH / DELETE | `/projects/:id`                                        | Read: project access. Update and archive: Admin, Owner                             |
| GET / POST           | `/projects/:id/members`                                | Read: project access. Add: Admin, Owner                                            |
| DELETE               | `/projects/:id/members/:userId`                        | Admin, Owner (also unassigns their tasks)                                          |
| POST / GET           | `/projects/:id/tasks`                                  | Project access. List: cursor-paginated, filters `status`, `priority`, `assigneeId` |
| GET / PATCH          | `/tasks/:id`                                           | Project access                                                                     |
| PATCH                | `/tasks/:id/status`                                    | Project access                                                                     |
| DELETE               | `/tasks/:id`                                           | The reporter, or Admin/Owner (soft delete)                                         |
| POST / DELETE        | `/tasks/:id/assignees`, `/tasks/:id/assignees/:userId` | Project access; assignees must be project members                                  |
| GET / POST           | `/workspaces/:id/labels`                               | Members (create); Admin/Owner rename and delete via `PATCH/DELETE /labels/:id`     |
| POST / DELETE        | `/tasks/:id/labels`, `/tasks/:id/labels/:labelId`      | Project access; the label must belong to the same workspace                        |
| GET / POST           | `/projects/:id/milestones`                             | Read: project access. Create: Admin, Owner                                         |
| PATCH / DELETE       | `/milestones/:id`                                      | Admin, Owner                                                                       |

## Collaboration API (M4)

Rules: [Docs/decisions/0004-collaboration.md](Docs/decisions/0004-collaboration.md). Lists use cursor pagination (`meta.nextCursor`, `meta.hasMore`).

| Method     | Endpoint                      | Who                                                                              |
| ---------- | ----------------------------- | -------------------------------------------------------------------------------- |
| POST / GET | `/tasks/:id/comments`         | Project access (oldest first). `@username` mentions notify people on the project |
| PATCH      | `/comments/:id`               | The author                                                                       |
| DELETE     | `/comments/:id`               | The author, or a workspace Admin/Owner (soft delete)                             |
| GET        | `/projects/:id/activity`      | Project access (newest first; `?taskId=` filter)                                 |
| GET        | `/notifications`              | Your notifications (`?unreadOnly=true`)                                          |
| GET        | `/notifications/unread-count` | Your unread count                                                                |
| PATCH      | `/notifications/:id/read`     | Your notification                                                                |
| POST       | `/notifications/read-all`     | Marks all of yours read                                                          |

## GitHub API (M5)

Rules: [Docs/decisions/0005-github-app-setup.md](Docs/decisions/0005-github-app-setup.md).

| Method | Endpoint                                  | Who                                                                                   |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/github/install?workspaceId=`            | Admin, Owner. Browser redirect to GitHub's install page                               |
| GET    | `/github/install/callback`                | Public. GitHub's redirect back, checked by state cookie and user token                |
| GET    | `/github/installations?workspaceId=`      | Admin, Owner                                                                          |
| GET    | `/github/installations/:id/repositories`  | Admin, Owner. Live from GitHub, with `connectedProjectIds`                            |
| GET    | `/projects/:id/repositories`              | Project access                                                                        |
| POST   | `/projects/:id/repositories`              | Admin, Owner. `{ installationId, githubRepositoryId }`                                |
| DELETE | `/projects/:id/repositories/:repoId`      | Admin, Owner. History is kept                                                         |
| POST   | `/projects/:id/repositories/:repoId/sync` | Admin, Owner. Imports the repo's 100 most recently updated PRs (also done on connect) |

## GitHub events API (M6)

Rules: [Docs/decisions/0006-github-events.md](Docs/decisions/0006-github-events.md). GitHub events never change task status.

| Method | Endpoint                            | Who                                                                    |
| ------ | ----------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/webhooks/github`                  | GitHub (HMAC `X-Hub-Signature-256`). 202 once stored; failures retried |
| GET    | `/internal/github/deliveries/retry` | Scheduler, `Authorization: Bearer $CRON_SECRET`                        |
| GET    | `/repositories/:id/pull-requests`   | Project access (`?state=open\|closed\|merged\|all`, paginated)         |
| GET    | `/tasks/:id/pull-requests`          | Task access                                                            |
| POST   | `/tasks/:id/pull-requests`          | Task edit access. `{ pullRequestId }`                                  |
| DELETE | `/tasks/:id/pull-requests/:prId`    | Task edit access                                                       |
| GET    | `/projects/:id/github/activity`     | Project access. Commits, PRs, reviews and releases                     |

## Real-time API (M7)

Rules: [Docs/decisions/0007-realtime.md](Docs/decisions/0007-realtime.md). Events are hints: clients refetch from the API.

| Method | Endpoint                          | Who                                                                                          |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/realtime/token`                 | Verified user. Returns a 60-second ticket for opening the socket                             |
| WS     | `/api/v1/realtime/socket`         | `auth: { token }`, WebSocket transport only. `subscribe` / `unsubscribe` `{ room }` with ack |
| GET    | `/internal/realtime/outbox/flush` | Scheduler, `Authorization: Bearer $CRON_SECRET`                                              |

Rooms: `user:<id>` (joined automatically), `project:<id>` and `workspace:<id>` (joined through `subscribe`, which checks access). Locally, no Redis is needed; the website connects to `NEXT_PUBLIC_REALTIME_URL` (default `http://localhost:4000`).

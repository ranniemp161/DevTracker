# DevTrack

DevTrack is an internal engineering project management platform with first-class GitHub integration.

- **Architecture reference:** [DEVTRACK_ARCHITECTURE.md](DEVTRACK_ARCHITECTURE.md)
- **Decision records:** [Docs/decisions/](Docs/decisions/)

**Status:** M1–M3 are complete. M4 (comments, mentions, activity feed and notifications) is implemented on the `m4-collaboration` branch.

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

The DevTrack GitHub App, which grants repository access, is set up separately in M5.

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

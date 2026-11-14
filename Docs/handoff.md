# DevTrack: handoff for the next engineering agent

> Update (2026-11-14): Real-time now runs in its own Vercel function
> (`apps/realtime`, PRs #13–#14). Section 5 is kept as the record of that work.
> What's left is release verification (§6). Features added after the release
> are in §9–§10.

**Date:** 2026-11-14 (first written 2026-11-07). **Repository:** `ranniemp161/DevTracker` (GitHub), working copy `D:\Projects\DevTracker` (Windows, Git Bash and PowerShell).

Read this whole file first. It says what is done, what is live, what is broken and how to fix it, and which traps have already been solved. **Don't undo those fixes** (§4).

## 1. Project in one minute

DevTrack is an internal project-management app with GitHub integration: workspaces, projects, tasks (Kanban and list), comments with @mentions, an activity feed, notifications, a GitHub App (repositories, pull requests, commits, reviews linked to tasks), and live updates over Socket.IO.

| Part    | Tech                                                                                                  | Folder                                                       |
| ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Website | Next.js 16 (App Router; `src/proxy.ts` is Next 16's "Proxy", formerly middleware)                     | `apps/website`                                               |
| API     | NestJS 12 (ES-module-only package), Express, Socket.IO gateway                                        | `apps/api`                                                   |
| Shared  | Drizzle ORM schema and migrations, types, Zod validators                                              | `packages/database`, `packages/types`, `packages/validators` |
| Tooling | pnpm 12 workspaces, Turborepo, TypeScript 6, Vitest (in-memory Postgres via PGlite), Prettier, ESLint | root                                                         |

**Source of truth, in this order:**

1. `DEVTRACK_ARCHITECTURE.md`, especially §21, the rules for engineering agents.
2. The decision records in `Docs/decisions/0001`–`0012`. Each milestone's rules are there (0009–0012 cover chat, shared GitHub connections, time in status, and time entries).
3. `Docs/deploy-runbook.md` and `Docs/release-checklist.md`.
4. For UI work: `design/SPEC.md` and `Docs/ui-redesign-plan.md`.

Milestones M1–M8 are all merged to `main`, and so are the post-release features in §9–§10. CI (`.github/workflows/ci.yml`) runs formatting, lint, typecheck, tests, build and a migration-drift check on every PR, and is green.

## 2. Production (Vercel, Hobby plan)

| What           | Value                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Website        | `https://dev-tracker-website.vercel.app` (Vercel project `dev-tracker-website`, Root Directory `apps/website`)            |
| API            | `https://api-woad-seven-42.vercel.app` (Vercel project `api`, Root Directory `apps/api`)                                  |
| Vercel team    | `rannie-moreno-peraltas-projects`. The Vercel CLI must be logged in as `ranniemp161` to see it.                           |
| Database       | Neon Postgres, production branch. All migrations applied.                                                                 |
| Redis          | Upstash (Vercel Marketplace) → `REDIS_URL` on the API project                                                             |
| Email / errors | Resend / Sentry (two projects)                                                                                            |
| GitHub         | Production OAuth App and GitHub App `devtrack-rannie`. The webhook points straight at the API: `…/api/v1/webhooks/github` |

**Environment variable names** (values live only in Vercel and the owner's password manager; never commit them):

- **API:** `DATABASE_URL`, `WEB_ORIGIN`, `TRUST_PROXY`, `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (base64 PEM), `GITHUB_APP_WEBHOOK_SECRET`, `CRON_SECRET`, `REALTIME_SECRET`, `WEB_PROXY_SECRET`, `REDIS_URL`, `SENTRY_DSN`.
- **Website:** `API_INTERNAL_URL`, `NEXT_PUBLIC_REALTIME_URL`, `WEB_PROXY_SECRET` (same value as the API's), `NEXT_PUBLIC_SENTRY_DSN`.

Config is validated at start-up in `apps/api/src/config/app-config.ts`. A missing or malformed value stops the API, and its log lists every problem.

**Note:** the owner's local `.env` currently points `DATABASE_URL` at the **production** database (their choice, for now). Local `pnpm dev` therefore writes to production; tests don't (they use PGlite).

## 3. Status

**Working in production (verified 2026-11-07):**

- website pages;
- API health;
- registration and login;
- GitHub sign-in;
- the GitHub App (installation, repositories, pull requests arriving by webhook);
- database and Redis connections.

**Real-time:** moved to the standalone server `apps/realtime` (`https://devtrack-realtime-poc.vercel.app`), and the website points at it. In production, the transport check and the fake-ticket rejection pass. The publisher startup fix (#14, decision 0007 "Publisher startup correction") is merged. These still need checking in production: the API is deployed with #14, a real user's ticket is accepted, and two browsers see each other's changes (§5 "Done when").

**Not done yet (as far as the repo shows):**

- GitHub Actions scheduled jobs (§6);
- the production acceptance checklist (§6).

## 4. Already solved: do not undo

The API's Vercel deployment needed four fixes (PRs #9–#12). The result:

- **Vercel's entry is `apps/api/server.mjs`**, which imports `@nestjs/core` (Vercel's NestJS preset requires that) and then `./dist/vercel/server.mjs`.
- **`apps/api/scripts/build-esm.mjs`** runs after `nest build`, as part of `pnpm build`:
  1. **SWC** compiles `src` to ES modules, keeping decorator metadata (Nest's dependency injection needs it).
  2. **esbuild** bundles that output **plus the `@devtrack/*` workspace packages** into one file, `dist/vercel/server.mjs`. Third-party packages stay external.
- **`src/main.ts` was renamed `src/bootstrap.ts`,** so Vercel doesn't auto-detect and re-type-check the TypeScript.

Why each piece exists:

1. Vercel's NestJS builder re-type-checked the sources with its own settings, and failed on code that passes CI.
2. NestJS 12 is ES-module-only, and Vercel's runtime refuses `require()` of ES modules (`ERR_REQUIRE_ESM`). Node allows it locally, which hides the problem. Reproduce locally with `node --no-experimental-require-module`.
3. Vercel's packager rewrites **our own** ES-module `.js` files (including the pnpm-linked workspace packages) to CommonJS, which breaks them. It leaves `.mjs` files and `node_modules` alone. Hence one bundled `.mjs`.
4. `drizzle-orm` and `pg` are direct API dependencies so the bundle can resolve them.

**Other known, harmless things:**

- Turborepo prints "environment variables … missing from turbo.json" on Vercel builds. These variables are read at runtime, not at build time. Ignore it.
- Vercel **preview** deployments are behind Vercel login (302), so test against production URLs, or use `vercel curl`.
- Read production logs with `vercel logs https://api-woad-seven-42.vercel.app --since 10m`.

## 5. Real-time on Vercel (implemented; acceptance pending)

> Option A below was built (`apps/realtime`, PRs #13–#14). Only the "Done when" checks 2–4 are still open.

**Symptom:** the browser's socket to `https://api-woad-seven-42.vercel.app/api/v1/realtime/socket` fails. A raw upgrade request returns **HTTP 404 with Express/helmet headers**. So the request reaches the Express app, but Socket.IO never sees it. Vercel's NestJS integration hands requests to the Express app, while Socket.IO (Nest's `IoAdapter` in `apps/api/src/realtime/realtime-io.adapter.ts`) listens on the Node HTTP server, which on Vercel doesn't receive them. Locally everything works, and `apps/api/test/realtime.e2e-spec.ts` passes.

**What already exists and must keep working:**

- **Publisher:** `apps/api/src/realtime/outbox-publisher.service.ts`. After each write request it reads `outbox_events` and calls `server.to(rooms).emit(type, envelope)`. With `REDIS_URL` set, the Socket.IO Redis adapter broadcasts that to **every** Socket.IO server sharing the Redis, which is the key to the fix below.
- **Tickets:** `apps/api/src/realtime/realtime-ticket.ts`. `POST /api/v1/realtime/token` (through the website proxy, cookie-authenticated) returns a 60-second HMAC ticket (`REALTIME_SECRET`) holding `{ sid, uid, exp }`.
- **Gateway rules:** `apps/api/src/realtime/realtime.gateway.ts`:
  - **On connect:** verify the ticket; the session (`sessions.id = sid`, unexpired) must exist and the user's email be verified; join `user:<id>`; disconnect after 4.5 minutes.
  - **`subscribe` / `unsubscribe` `{ room }`,** with an ack: rooms are `workspace:<uuid>` and `project:<uuid>`, authorized with the same checks as the REST API (`WorkspaceAccessService`, `ProjectAccessService`).
  - Uses the WebSocket transport only.
- **Browser client:** `apps/website/src/lib/realtime.tsx` connects to `NEXT_PUBLIC_REALTIME_URL` with path `/api/v1/realtime/socket`, and reconnects and reconciles. Rules are in `Docs/decisions/0007-realtime.md`.

**Recommended fix (option A): a separate real-time function.** Keep the API as the publisher. Add a small standalone Socket.IO server deployed the way Vercel documents it: a plain Node `http.createServer()` with Socket.IO attached, as the default export (<https://vercel.com/docs/functions/websockets>, generally available since 2026-10-20, Fluid compute).

1. **Proof of concept first (do this before anything else).**
   - Create `apps/realtime` with one entry file exporting an HTTP server with Socket.IO (`transports: ['websocket']`, `path: '/api/v1/realtime/socket'`) that emits `realtime.ready` on connect.
   - Deploy it as a new Vercel project (Root Directory `apps/realtime`).
   - Check with the script in §7 that it **connects** (the `connect` event fires).
   - If Vercel WebSockets fail even here, switch to option B and don't build A.
2. **Full version:**
   - Port the gateway rules above into the new server: ticket check, session lookup with `@devtrack/database`, room authorization, 4.5-minute limit, Redis adapter on the same `REDIS_URL`.
   - Room authorization needs the workspace and project access queries. Move them out of the API services into a shared helper or package, rather than copying them, so both use one implementation.
   - **Bundle it the same way as the API** (esbuild → one `.mjs`, workspace packages inlined). Otherwise trap 3 in §4 recurs.
   - Env vars for the new project: `DATABASE_URL`, `REDIS_URL`, `REALTIME_SECRET`, `WEB_ORIGIN` (for CORS).
   - Set the website's `NEXT_PUBLIC_REALTIME_URL` to the new project's URL and **redeploy the website**: `NEXT_PUBLIC_*` values are baked in at build time.
   - Remove the Nest gateway, or leave it unused (it doesn't hurt). The publisher's `server.to(...).emit` keeps working through Redis either way.
3. **Tests:** cover the new server's ticket and room authorization. The existing `realtime.e2e-spec.ts` shows the expected behaviour.

**Fallback (option B): a managed service** (Ably or Pusher). The API publishes outbox events to the service, and the browser subscribes with short-lived tokens issued by a new API endpoint, with channel rights matching the room rules. Only the transport changes; the outbox, tickets/room rules and the client's refresh logic stay.

**Done when:**

1. The §7 script connects to production.
2. Two browsers signed in as different users on the same project see each other's changes within about 2 seconds, without refreshing.
3. A user outside the project can't subscribe to it.
4. `Docs/decisions/0007-realtime.md` records the outcome.

## 6. Remaining release steps

1. **Scheduled jobs:** in GitHub → repository Settings → Secrets and variables → Actions, add:
   - variable `API_URL` = `https://api-woad-seven-42.vercel.app`
   - secret `CRON_SECRET` = the API's value

   Then run the **Scheduled jobs** workflow once by hand and check it's green (`.github/workflows/scheduled-jobs.yml`).

2. **Acceptance:** tick the production column of `Docs/release-checklist.md`. Item 15–16 (live updates) depends on §5.
3. **Optional:** clear the Turborepo env warnings by listing runtime variables under `globalPassThroughEnv` in `turbo.json`.

## 7. Useful commands

```bash
pnpm install
pnpm dev                       # website :3000, API :4000 (uses the root .env)
pnpm turbo run typecheck lint test build   # what CI runs (plus a format check: pnpm format:check)
pnpm db:generate --name <name> # after schema changes in packages/database/src/schema
pnpm db:migrate                # applies migrations to DATABASE_URL from the root .env

# Production checks
curl https://api-woad-seven-42.vercel.app/api/v1/health
vercel logs https://api-woad-seven-42.vercel.app --since 10m
```

Socket check (run from `apps/api`, where `socket.io-client` is installed). A fake ticket should connect, then be refused by the gateway:

```bash
node -e "
const {io}=require('socket.io-client');
const s=io(process.argv[1],{path:'/api/v1/realtime/socket',transports:['websocket'],auth:{token:'fake'},reconnection:false});
s.on('connect',()=>console.log('CONNECTED (WebSocket works)'));
s.on('realtime.error',e=>console.log('gateway answered',e));
s.on('connect_error',e=>{console.log('connect_error',e.message);process.exit(1)});
s.on('disconnect',r=>{console.log('disconnected:',r);process.exit(0)});
setTimeout(()=>process.exit(1),20000);" https://<realtime-or-api-url>
```

## 8. Working rules (from the owner and `DEVTRACK_ARCHITECTURE.md` §21)

- **Ask before anything outward-facing:** deploys, `vercel` commands that change projects or env vars, pushing, opening or merging PRs, and anything touching production data. The owner approves each step.
- **Change workflow:** one change per branch, then a PR to `main`. CI must be green before merging. The owner usually merges.
- **Checks before committing:** add or adjust tests with every change, and keep `pnpm turbo run typecheck lint test build` and `pnpm exec prettier --check .` passing.
- **Decisions and docs:** before changing an architectural decision, explain the trade-off and get approval. Record approved decisions in `Docs/decisions/` and keep `README.md` and the architecture doc in step.
- **Secrets:** never commit them, never print them in logs or chat, and never put them in activity or outbox payloads.
- **Line endings:** the repo uses LF (`.gitattributes`). On Windows, write files with UTF-8 and LF.

## 9. Project Chat and Core UX Upgrades (Milestones 9–12)

Implemented according to [`Docs/project-chat-and-ux-plan.md`](file:///D:/Projects/DevTracker/Docs/project-chat-and-ux-plan.md) and [`Docs/decisions/0009-project-chat.md`](file:///D:/Projects/DevTracker/Docs/decisions/0009-project-chat.md).

### 9.1 Database & Persistence

- **Migration:** `packages/database/migrations/0007_project_chat.sql`.
- **Tables:**
  - `project_messages`: monotonic `sequence` per project allocated under row lock on `projects.next_message_sequence`. Unique index on `(project_id, author_id, client_request_id)` for idempotent sends. Soft-deletion via `deleted_at`.
  - `project_message_mentions`: extracted `@username` mentions, linked to project members.
  - `project_chat_reads`: monotonic tracking of `last_read_sequence` per user per project.
  - `projects.next_message_sequence`: atomic sequence generator.
- **Privacy Invariant:** Outbox events (`outbox_events`), Socket.IO broadcasts, activity items, and server logs NEVER carry message bodies—only `{ messageId, sequence, projectId, actorId }`. Clients fetch full message payloads via authenticated REST endpoints.

### 9.2 API & Realtime

- Endpoints in `apps/api/src/chat/`:
  - `POST /api/v1/projects/:id/messages`: send message with idempotency.
  - `GET /api/v1/projects/:id/messages`: cursor-paginated messages (`limit`, `before`, `after`, `around`).
  - `PATCH /api/v1/messages/:id`: author-only message edit.
  - `DELETE /api/v1/messages/:id`: author or admin/owner moderation soft-deletion.
  - `PUT /api/v1/projects/:id/chat/read`: monotonic read state advance.
  - `GET /api/v1/workspaces/:id/chat/unread`: batch unread counts across all accessible projects.
- Realtime routing in `packages/server-core/src/rooms.ts`:
  - `chat.message.*` -> `project:<projectId>`
  - `chat.read` -> `user:<userId>`
- Scoped notifications in `apps/api/src/notifications/notifications.service.ts`:
  - Mentions notify eligible project members with `resourceType: 'chat_message'` and deep link `/projects/:id/chat?message=<id>`. Revoked/former members cannot see or receive notifications.

### 9.3 Frontend Live Chat (`/projects/[id]/chat`)

- **Composer:** In-memory drafts per project, @mention autocomplete dropdown, task reference picker pill, keyboard shortcuts (Enter to send, Shift+Enter for newline).
- **History:** Monotonically ordered, grouped by calendar date dividers, "Load earlier" preserving scroll position relative to viewport.
- **Optimistic UI:** Messages display immediately as sending/failed, with retry utilizing original `clientRequestId`.
- **Deep Linking:** Navigating with `?message=<id>` fetches the message around the target, scrolls it into center view, and temporarily highlights it with an amber border.
- **Resilience:** Visual banner on disconnect with fallback 15s polling, automatic message reconciliation on reconnect.
- **Unread Tracking:** Unread count badge on Project Chat tab and Project list cards, auto-cleared when scrolled near the bottom.

### 9.4 Core UX Improvements

- **Workspace Navigation:** Fixed workspace switcher in header to resolve workspace from current project on `/projects/:id` routes.
- **Horizontal Scrollable Tabs:** Project navigation tabs scroll smoothly on mobile/narrow viewports. _(Superseded by the redesign: the sidebar shell replaced the tab strip.)_
- **Unified URL Filters:** Shared query parameters (`?status=...&priority=...&assignee=...&label=...`) across Kanban Board and List views with tab-switching query preservation. Added "unassigned" option support.
- **Accessible Kanban Status Action:** Each task card has a status control for keyboard and touch, alongside drag-and-drop. _(Now the status menu button in `task-status-menu.tsx`, SPEC R2.)_
- **Task Creation Draft Retention:** `QuickAdd` preserves draft title in session storage across reloads and tab navigations.
- **Task Detail Enhancements:** Clear grouping with a direct "Discuss in chat" button linking to `/projects/[id]/chat?task=[taskId]`.

## 10. Post-release features and UI redesign (PRs #17–#26)

### 10.1 Features

| PR  | Change                                                                                              | Decision |
| --- | --------------------------------------------------------------------------------------------------- | -------- |
| #19 | Connect a GitHub App installation that already exists to a workspace (no install callback needed)   | 0005     |
| #20 | Board: task detail drawer (`?task=<id>`), quick-add at the bottom of each column, card interactions | —        |
| #21 | One GitHub installation shared by several workspaces                                                | 0010     |
| #22 | Tasks linked to milestones, plus milestone acceptance criteria (SPEC R3)                            | —        |
| #23 | The task Save bar no longer spins forever                                                           | —        |
| #24 | Time spent in each task status, worked out from the activity history                                | 0011     |
| #25 | Task estimates and logged time entries (migration `0010_time_entries.sql`; landed through #24)      | 0012     |
| #26 | Website unit tests for duration and date labels                                                     | —        |

### 10.2 UI redesign (`design/SPEC.md` §7)

All seven build steps are done (#17, #18, then refined in #20 and #22):

- `apps/website/src/styles/tokens.css` is in place, and the legacy alias block has been removed. No legacy classes remain in `apps/website/src`.
- The primitives are in `components/ui.tsx` and `components/icons.tsx`, and the app icon is in `app/icon.svg`.
- The sidebar shell with its mobile drawer is in `app-shell.tsx`, and the project tab strip is gone.
- Every route in SPEC §5 has a page.

The branch `feature/ui-redesign` was never merged and is out of date, because #17 shipped the same work.

Token-rule clean-up (SPEC §1): the arbitrary values in the chat panel, the mobile drawer and the milestone form, and the logo's hardcoded white, were replaced with tokens and named utilities (branch `fix/website-token-deviations`). One deviation is still open:

- `features/projects/label-chip.tsx`: `LABEL_COLORS` (the label colour picker) uses Tailwind hexes, not the `--dt-label-*` palette. These values are stored in the database as label colours, so changing them needs a decision about labels that already exist.

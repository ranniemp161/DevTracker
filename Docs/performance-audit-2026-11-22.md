# Performance audit — 2026-11-22

Measured on production (board page, signed in) from a browser served by Vercel's `sin1` (Singapore) edge. Functions run in `lhr1` (London) beside Neon `eu-west-2`.

## Findings

- **Latency is geography, not the database.** Every API call takes ~280–380 ms, including `/api/v1/health`, which doesn't touch the database (~290–360 ms). Database work adds ~10–50 ms.
- **The board loads in ~5 serial rounds:** `auth/me` → `workspaces` → 5 parallel → 3 → 2. That's 13 calls and ~1.5–1.8 s before it's ready.
- **`/projects/:id` is fetched twice:** once by the app shell and once by the project context.
- **No client-side cache:** `useApiQuery` refetches on every page change.
- **Database pool:**
  - Uses Neon's pooler (PgBouncer), `max: 5`, idle timeout 10 s, connect timeout 10 s, with an error handler. ✅
  - Not registered with Vercel's `attachDatabasePool`. ⚠️
- **Queries:**
  - Auth is 1 query.
  - The board's hydrate step runs 4 batched queries per page.
  - Project counts use correlated subqueries in one query.
  - Search and My tasks are 1 query each.
  - Small loops that are fine for now:
    - webhook handlers, one query per connected project;
    - `pull-requests.service.ts:231`, an access check per linked project;
    - bulk task update, one query per task, capped by the bulk size.
- **Caching:**
  - `/_next/static` is `immutable` and served from the edge. ✅
  - API responses aren't cached over HTTP. That's correct for private data.
  - Redis is only used for realtime.
  - `favicon`/`icon.svg` are `max-age=0`, which is minor.

## Checklist, biggest impact first

- [x] **1. Fewer request rounds and no duplicates (website, plus a small API change)**
  - [x] `/auth/me` also returns the user's workspaces, which removes a serial round.
  - [x] Start the shell's independent requests in parallel: unread count, timer, workspace projects, chat unread.
  - [x] Share `/projects/:id` between `app-shell.tsx` (`projectQuery`) and `project-context.tsx`, so it's fetched once.
  - [x] Goal: the board is ready in ~2 rounds instead of ~5. Measure with `performance.getEntriesByType('resource')`.
- [x] **2. Client data cache (stale-while-revalidate)**
  - [x] Give `useApiQuery` an in-memory cache keyed by path: return cached data at once, then refetch in the background.
  - [x] Clear or refresh entries from the existing realtime events (`useRealtimeRefresh`) and after writes.
  - [x] Keep the current behaviour: errors, `reload()`, and loading only when nothing is cached.
- [x] **3. `attachDatabasePool`** (reliability on Vercel)
  - [x] Register the pg pool with `attachDatabasePool(pool)` from `@vercel/functions` (already a dependency) in `apps/api/src/database/database.module.ts`. Do this only when running on Vercel, so tests and local dev are unchanged.
- [x] **4. Hosting region (a decision, not code)** — decided 2026-11-22: stays as it is.
  - [ ] Decide where most users are. If they're in Asia, plan a move to Vercel `sin1` and Neon `ap-southeast-1`: a database migration plus a region change for all three projects. Expect ~300 ms → ~50–80 ms per call.

Constraints:

- **Production database:** the local `.env` database is production. Migrations need approval.
- **Deploys:** confirm each deploy first.
- **PRs:** one PR per item, based on `main`.

Done: #94 (item 3), #95 and #97 (item 2, including board tasks), #96 (item 1).

## Response sizes on the board page — 2026-11-26 (#110)

Measured on production, signed in, with a one-off console snippet that reads `transferSize` and `decodedBodySize` from `performance.getEntriesByType('resource')`. No code was shipped for it. The buffer covers the whole tab session: sign-in, the board, and two task details opened from it. That is 66 API calls with ~58 KB transferred in total.

| Endpoint                                                                                                                                              | Calls    | Transferred (KB) | Decoded (KB) |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- | ------------ |
| `tasks/:id/timeline?kind=all&limit=50`                                                                                                                | 2        | 2.2              | 15.3         |
| `projects/:id/tasks?limit=200` (board, both sorts)                                                                                                    | 4        | 1.7              | 5.8          |
| `workspaces/:id/projects`                                                                                                                             | 4        | 1.6              | 5.6          |
| `tasks/:id/checklist`                                                                                                                                 | 2        | 1.0              | 2.0          |
| `projects/:id/milestones`                                                                                                                             | 4        | 0.9              | 1.4          |
| `tasks/:id/time-entries`                                                                                                                              | 2        | 0.7              | 1.3          |
| `tasks/:id`                                                                                                                                           | 2        | 1.0              | 1.2          |
| `projects/:id`, `tasks/:id/pull-requests`                                                                                                             | 4, 2     | 1.0–1.1          | 0.8          |
| `auth/me`                                                                                                                                             | 2        | 0.4–1.0          | 0.1–0.7      |
| `workspaces/:id/labels`, `chat/unread`                                                                                                                | 4, 5     | 0.9–1.0          | 0.6–0.7      |
| Every other call (members, repositories, attachments, realtime token, workspace, time in status, unread count, active timer, done prompts, relations) | 1–9 each | 0.4–0.8          | 0.1–0.5      |

**What this shows:**

- **No endpoint is oversized.**
  - The largest is the task timeline: 15.3 KB decoded, 2.2 KB after compression.
  - Every board call is under 6 KB decoded and under 2 KB on the wire.
  - For most calls, response headers weigh more than the body.
  - No follow-up issues to trim payloads.
- **Bytes don't matter here; round trips do.**
  - A typical call takes ~270–670 ms whatever its size, which matches the geography finding above.
  - A few calls took 3–6 s: `auth/me` 5.7 s (the first call of the session), `tasks/:id/relations` 4.0 s, `chat/unread` 3.5 s and `projects/:id/milestones` 3.2 s. This looks like function cold starts, but it wasn't investigated.
- **Repeated calls are by design, not overfetching.**
  - Endpoints that appear 4–9 times were refreshed once per page change.
  - `useApiQuery` revalidates on mount, the notification bell refreshes its count on each navigation, and the timer and chat unread refresh on focus.
  - Each refresh is a 0.4–1.7 KB response.
- **Caveat:** this was a small project. The board's task list grows with every task, so measure it again on a project with a few hundred tasks before relying on these numbers there.

**Verdict on TanStack Query and tRPC:** neither is worth adopting now.

- tRPC changes typing, not payload shape.
- The payloads are already small.
- `api-cache.ts` already covers what TanStack Query would add for us: stale-while-revalidate, sharing requests in flight, an LRU cap, and refreshing after writes and realtime events.
- If TanStack Query is adopted later, put it behind the existing `useApiQuery` interface so its callers don't change.

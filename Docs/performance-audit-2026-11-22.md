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

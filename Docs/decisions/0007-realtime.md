# 0007 — Real-time delivery: Socket.IO on Vercel Functions with Redis

- **Status:** Accepted (M7). Running the gateway on Vercel itself still needs a proof-of-concept deploy (see "Not yet verified").
- **Date:** 2026-11-06
- **Scope:** Milestone M7 — architecture §4, §10, §14
- **Records:** Open decisions #2 (Redis provider) and #3 (real-time hosting)

Rules 1 and 2 were approved before implementation (§21 rule 12).

## 1. Hosting (approved)

Vercel Functions support WebSockets, generally available since October 20, 2026 ([docs](https://vercel.com/docs/functions/websockets)). Socket.IO and Node HTTP servers work without a Vercel-specific API. The constraints that shaped this design:

- **WebSocket transport only.** HTTP long-polling isn't supported, so server and client both set `transports: ['websocket']`.
- **A connection stays on one function instance**, and a reconnect may land on another instance. Vercel provides no pub/sub between instances. So **Redis** (`REDIS_URL`, via the Socket.IO Redis adapter) broadcasts across instances. Upstash Redis from the Vercel Marketplace is the expected provider (open decision #2).
- **Connections end at the function's maximum duration** (300 s on Hobby). The server closes each connection itself after **4.5 minutes** (`REALTIME_MAX_CONNECTION_MS`), and the client reconnects (rule 4).
- The Socket.IO gateway runs inside the existing Nest API, so there is no second service.

Without `REDIS_URL` (development, tests), broadcasting stays inside one process. Production requires `REDIS_URL` and `REALTIME_SECRET`.

## 2. The plan is Vercel Hobby (approved)

Hobby cron runs only once a day, so recovery jobs are triggered without Vercel Cron:

- **After every successful write request** (including GitHub webhooks), the API flushes the outbox in the background. `waitUntil` from `@vercel/functions` keeps the function alive after the response has been sent.
- **A GitHub Actions schedule** (`.github/workflows/scheduled-jobs.yml`, every 10 minutes) calls both recovery endpoints with `CRON_SECRET`:
  - `GET /internal/github/deliveries/retry` (M6)
  - `GET /internal/realtime/outbox/flush` (M7)

  It is skipped until the repository variable `API_URL` is set (M8).

## 3. Authentication: connection tickets

The website reaches the API through its same-origin `/api/v1` proxy, so the session cookie belongs to the website's origin. Socket.IO connects to the **API origin directly** (`NEXT_PUBLIC_REALTIME_URL`), because the Next.js proxy doesn't carry WebSocket upgrades. The cookie isn't sent there. So:

1. The browser calls `POST /api/v1/realtime/token` through the proxy. This is cookie-authenticated and requires a verified email.
2. The API returns a **60-second ticket**: `{ sid, uid, exp }`, signed with HMAC-SHA256 using `REALTIME_SECRET`.
3. The browser opens the socket with `auth: { token }`. The gateway checks the signature and expiry, and checks that the **session still exists** and the email is verified. Otherwise it emits `realtime.error` and disconnects.

A fresh ticket is fetched for every connection and reconnection. Tickets aren't stored. A revoked session can't connect, even with an unexpired ticket. The CORS origin is the website only, with `credentials: false`.

The socket path is `/api/v1/realtime/socket`. Socket.IO answers every URL under its path, so REST routes such as `/api/v1/realtime/token` must stay outside it.

## 4. Rooms and authorization (§10)

| Room             | Joined by                                                                             |
| ---------------- | ------------------------------------------------------------------------------------- |
| `user:<id>`      | The server, on connect. Clients can never request it.                                 |
| `project:<id>`   | `subscribe`, if `ProjectAccessService.require` passes (the same rule as the REST API) |
| `workspace:<id>` | `subscribe`, if `WorkspaceAccessService.require` passes                               |

- `subscribe` replies with an acknowledgement: `{ ok: true }`, or `{ ok: false, error }` where `error` is `NOT_FOUND`, `FORBIDDEN`, `INVALID_ROOM`, `TOO_MANY_ROOMS` (more than 50 rooms) or `UNAUTHENTICATED`.
- "No access" and "does not exist" give the same answer, as in the REST API.
- **Revocation:** rooms are only re-authorized on reconnect, and the server closes connections every 4.5 minutes. So someone removed from a project stops receiving its events within that window. Events carry only IDs and small change sets, and content is always loaded through the API, which authorizes again.

## 5. Outbox publisher (§10 reliable delivery)

- `OutboxPublisher.flush()` claims unpublished rows in order with `SELECT … FOR UPDATE SKIP LOCKED`, at most 100 per transaction and 10 transactions per flush. It sends each row, then sets `published_at` and increments `attempts`. A flush running in one process merges with a new request for a flush.
- **Routing:**
  - `notification.*` events go to `user:<aggregate_id>`;
  - events with a `projectId` go to `project:<id>`;
  - other events with a `workspaceId` go to `workspace:<id>`.
- **Payload:** the §10 envelope with an `id` added (the outbox row ID), sent as the Socket.IO event named after `event_type`.
- **At least once.** A crash after sending but before commit re-sends the batch, and clients drop duplicates by `id`.
- **Stale rows** (older than 15 minutes) are marked published without being sent. Clients that were away that long have reconnected and refetched since.
- Retention of published rows is still decided in M8 (open decision #7).

## 6. Client behaviour (§10 reconnection)

`apps/website/src/lib/realtime.tsx`:

- One socket per tab, created only for verified users.
- Reconnects with exponential backoff (1 s, doubling, capped at 30 s) after any disconnect, including the server's planned ones. Socket.IO doesn't reconnect by itself after a server-initiated disconnect.
- After reconnecting, it rejoins its rooms and calls every view's refresh function, because events may have been missed.
- Events are **hints**. Views refetch from the API, debounced by 250 ms:
  - the board and list on `task.*`;
  - the task page on `task.*` for that task;
  - comments on `comment.*` for that task;
  - the activity feeds on `activity.created`;
  - the PR card on PR events;
  - the project header on `project.*` activity;
  - the notification bell on `notification.*`.
- The bell's 60-second polling is removed.

## 7. API additions

| Method | Path                              | Who                                                                                                                                                   |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/realtime/token`                 | Verified user (session cookie)                                                                                                                        |
| GET    | `/internal/realtime/outbox/flush` | Scheduler (`Bearer CRON_SECRET`)                                                                                                                      |
| WS     | `/api/v1/realtime/socket`         | Ticket in `auth.token`. Events: `subscribe`, `unsubscribe` (with ack). Server events: `realtime.ready`, `realtime.error`, and every outbox event type |

## Not yet verified

- **A Nest gateway on Vercel.** Vercel documents Express, `ws` and Socket.IO servers. Whether a NestJS application, deployed as a Vercel function, accepts WebSocket upgrades on its HTTP server must be confirmed with a deploy in M8, which is where deployment is configured.
  - **If it doesn't work:** keep the publisher and client and change only the transport. Either use a small Socket.IO-only Vercel function (Express/`ws` style, as documented) sharing the same Redis and ticket secret, or use a managed service. The outbox, tickets, rooms and client contract stay the same.
- **Billing for idle connections.** Vercel bills active CPU only while messages are processed. Whether provisioned memory is billed while a connection is open and idle isn't documented. Check it in the Vercel usage dashboard after deploying.

## Implementation notes

- **Code layout:** `apps/api/src/realtime/` contains:
  - the gateway;
  - the adapter (`RealtimeIoAdapter`: path, transport, CORS, Redis);
  - tickets, rooms and the publisher;
  - the after-response interceptor and the controller.

  `setupRealtime()` connects Redis before the app starts, from both `main.ts` and the tests.

- **HTTP-only pieces made explicit:**
  - The global response-envelope interceptor now skips non-HTTP contexts, so socket acknowledgements aren't wrapped.
  - The exception filter logs non-HTTP errors instead of writing an HTTP response.
- **Tests:**
  - `test/realtime.e2e-spec.ts` uses a real Socket.IO client against a listening app. It covers tickets, refused and expired connections, revoked sessions, the maximum connection age, room authorization, delivery to project and user rooms, and the scheduled sweep.
  - Other suites run with `publishAfterResponse: false` so they can assert on unpublished outbox rows.
- **Restored from M6:** the activity feed's "`<login>` (GitHub)" label for GitHub senders. Its M6 edit hadn't applied.

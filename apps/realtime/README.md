# DevTrack realtime transport

Socket.IO connection server at `/api/v1/realtime/socket`. The API keeps REST,
ticket issuance and the durable outbox. Its Redis adapter broadcasts to this
server through the same Redis. No application writes happen here.

## Status

The unauthenticated hosting probe passed on 2026-11-07 at
`https://devtrack-realtime-poc.vercel.app`: client `connect` fired with
transport `websocket`, followed by `realtime.ready`. Deployment:
`dpl_bLM5RGGciBpaPtNfDjzPiFBMDHuQ`.

The authenticated implementation was deployed with owner approval on 2026-11-07:
`dpl_62y7NSevRLvqx9YXC6MqyZ7yuXBN`, at the same URL. Hosted WebSocket
connection, invalid-ticket rejection and server disconnect passed. Redis
initialization succeeded. Valid-user authentication, API-to-realtime Redis
delivery and two-browser acceptance remain pending. The website URL was updated
with owner approval and rebuilt in deployment `dpl_F3q5jVUyDW17BGifQvy7evb6SNxb`.
The served JavaScript contains this realtime URL. A connection using the website
Origin passed transport and fake-ticket rejection checks; real-user acceptance
still needs a signed-in browser.

## Runtime and build

- Native Vercel entry: `api/v1/realtime/socket.mjs`. Rewriting to a different
  function path returned 404 during the probe; the native route passed.
- `scripts/build.mjs` bundles TypeScript and workspace packages into one
  `dist/server.mjs`; third-party modules remain external (including direct
  dependencies `drizzle-orm` and `pg`). No Nest decorators are needed.
- `vercel.json` builds dependencies through Turborepo, serves `public`, and
  gives the socket function a 300-second maximum. Use Other preset, Node 24 and
  Fluid compute, with Root Directory `apps/realtime`.
- The server does not load the root `.env`. Required variables:

| Variable          | Requirement                                 |
| ----------------- | ------------------------------------------- |
| `DATABASE_URL`    | Same database as API, pooled PostgreSQL URL |
| `REDIS_URL`       | Same Redis as API; required in production   |
| `REALTIME_SECRET` | Same API HMAC key, at least 32 characters   |
| `WEB_ORIGIN`      | Website origin, HTTPS in production         |

Session lookup, workspace/project visibility queries, ticket verification and
room names come from `@devtrack/server-core`, also used by the API.
Connections recheck session existence/expiry, ticket user ID and verified email.
Only the server joins personal rooms. Project/workspace joins are authorized,
serialized and capped at 50. Connections close after 270 seconds; the existing
browser client obtains a fresh ticket, rejoins and reconciles after reconnect.

## Verification

Tests use PGlite, synthetic settings and an optional **test-only** Redis. They
never load the local production database environment.

`pnpm turbo run build --filter=@devtrack/realtime` builds dependencies and the
runtime. `pnpm --filter @devtrack/realtime test` covers auth, rooms and lifetime.
Set `TEST_REDIS_URL` to an isolated local Redis for the cross-server broadcast
test; without it that test is explicitly skipped. CI provides a Redis service.
Never set this variable to the production Redis.

`pnpm --filter @devtrack/realtime test:bundle` verifies the actual function
entry with `--no-experimental-require-module`, a fake ticket, and a synthetic
unused database URL; run after building. Formatting, lint and typecheck are
part of the root checks.

## Cutover (owner approval required)

1. Provision the four matching variables on the realtime project securely.
2. Deploy the full server; check a fake ticket connects then receives
   `realtime.error` with `UNAUTHENTICATED` and disconnects.
3. Verify a real session ticket yields `realtime.ready`, project authorization
   denies outsiders, and API outbox events reach authorized sockets via Redis.
4. Set the website's `NEXT_PUBLIC_REALTIME_URL` to the authenticated realtime
   URL, then rebuild/redeploy the website (the value is baked into the bundle).
5. Complete the two-user browser acceptance check in handoff section 5 and
   record the hosted outcome in decision 0007.

Keep the Nest gateway for local development and the API publisher. No database
migration is required. Roll back the website URL/build and realtime deployment
independently if needed; durable state remains in the API/database.

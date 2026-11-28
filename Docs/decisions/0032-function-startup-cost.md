# 0032 — Function startup cost: bundle third-party packages, quiet Sentry

- **Status:** Accepted (PRs #168, #169, #170)
- **Date:** 2026-11-29
- **Scope:** Build of `apps/api` and `apps/realtime` for Vercel Functions (Fluid compute); Sentry options in the API
- **Builds on:** 0007 (realtime), 0008 (release readiness, §2 Sentry and §7 deployment)
- **Supersedes:** 0008's "third-party packages stay imports from `node_modules`" for the API build

## 1. The problem

With one user, the Vercel Hobby team had used **2 h 46 m of the 4 h Fluid Active CPU** allowance in 30 days. Nearly all of it was DevTrack:

| Project                 | Active CPU (30 days) |
| ----------------------- | -------------------- |
| `api`                   | 1 h 15 m             |
| `devtrack-realtime-poc` | 57 m                 |
| `dev-tracker-website`   | 31 m                 |

Fluid bills Active CPU only while code runs, not while it waits on Postgres, Redis or the network. So the cost was not slow queries. It was work the functions did themselves.

## 2. What we measured

**The cron was not the cause.** It makes ~17% of API invocations, and cold starts were only ~5%.

**Realtime cost ~1.2 s of CPU per socket connection (P75 2.1 s), yet an open socket is almost free.** A local probe of `apps/realtime` showed:

| Step                                              | CPU           |
| ------------------------------------------------- | ------------- |
| Connect, verify ticket, load session, join a room | 15–80 ms      |
| Connected socket, idle for 30 s                   | ~0 ms         |
| **Loading the code (importing the built file)**   | **1.8–2.1 s** |

Per package: `redis` 220–440 ms, `@devtrack/server-core` 280–370 ms, `drizzle-orm` ~250 ms, `socket.io` ~100 ms, `zod` ~60 ms.

**The API was worse: 6.1–7.0 s of CPU from process start to "listening"**, almost all of it imports (Nest, the AWS SDK, Sentry, drizzle, pg, redis, socket.io).

Vercel labels only some new instances "cold". Prewarmed instances load the code too, and that CPU is billed. So startup dominated the bill although the dashboard said 94% of starts were "hot".

## 3. Why startup was expensive

Both builds used esbuild but kept every package except `@devtrack/*` as an import:

```js
// old: apps/realtime/scripts/build.mjs and apps/api/scripts/build-esm.mjs
if (bare && !args.path.startsWith('@devtrack/')) return { path: args.path, external: true };
```

At startup Node resolved each import in `node_modules` (through pnpm's symlinks), read the package's `package.json`, then read and compiled each file, recursively: thousands of small files per instance.

## 4. Decision: bundle everything into one minified `.mjs`

esbuild follows the whole import tree once, at build time, and writes one file: `apps/api/dist/vercel/server.mjs` (~4.7 MB) and `apps/realtime/dist/server.mjs` (~1.5 MB). Startup reads and compiles one file.

```js
await build({
  bundle: true,
  minify: true,
  keepNames: true, // API only: Nest's dependency injection uses class names
  external: [
    '@node-rs/argon2', // API: native .node binary, picks the platform build at runtime
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    'class-transformer',
    'class-validator', // API
    'bufferutil',
    'utf-8-validate',
    'pg-native',
    '@node-rs/xxhash',
  ],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
```

- **Only two kinds of package stay external.** Native add-ons can't be bundled. Optional packages are loaded in `try/catch` (or only when a feature is used) and aren't installed. esbuild fails the build on both until they're listed.
- **The `createRequire` banner** gives bundled CommonJS code a `require()` inside the ES module.
- **The output is still one `.mjs` file**, so 0008's reasons hold: Vercel leaves `.mjs` alone and doesn't rewrite it to CommonJS.

### Results

| Startup CPU                                        | Before    | After       |
| -------------------------------------------------- | --------- | ----------- |
| API (local, process start → listening)             | 6.1–7.0 s | 0.47–0.61 s |
| Realtime (local, import)                           | 2.2–2.4 s | 0.25–0.38 s |
| Realtime on Vercel (`realtime.instance_ready` log) | —         | 583 ms      |

In production after the change, five socket connections in seven minutes went to one warm instance. Each new connection cost ~50–100 ms. Keeping the instance alive with sockets open cost ~2.4 ms of CPU per second, shared by everyone on it.

### Checks

- The old and new API bundles, started without a database, returned **identical** responses to: health, an unknown route, sign-in with an invalid body, sign-in with a valid one, and the GitHub webhook. This covers dependency injection, guards, pipes, filters and the response envelope.
- `apps/realtime` `test:bundle` starts the real bundled entry and completes a socket handshake.
- In production: health ok, sign-in (argon2) ok, chat and live updates ok.

## 5. Sentry: one call per API request

The API made ~2.8K calls to Sentry in 12 hours against ~1.3K requests, with no errors. On Vercel, `@sentry/node` 11 flushes after **every** HTTP response (`setupVercelKeepAlive`, through `waitUntil`), and three features we don't use had something to send each time:

- **request sessions** (release health, `httpIntegration` `sessions: true` by default);
- **client reports** (SDK statistics, `sendClientReports: true` by default);
- **the process session**, which starts whenever a release is set (always in production: `VERCEL_GIT_COMMIT_SHA`) and is sent along with every error.

`sentryOptions()` in `apps/api/src/observability/sentry.ts` turns all three off. Errors are reported as before, but we lose Sentry's Release Health page, which we didn't use. `sentry-requests.spec.ts` simulates Vercel with a release set: successful requests send nothing, and an error sends exactly `[['event']]`. The first CI run caught the process session only because CI sets `GITHUB_SHA`. The test now always sets a release.

## 6. Instance logs

`apps/realtime/src/runtime.ts` writes two JSON lines to stdout (no user data):

- `realtime.instance_ready {cpuMs}`: CPU spent before the instance accepts sockets;
- `realtime.connection {instanceConnections, instanceUptimeS, instanceCpuMs}`: whether connections reuse a warm instance.

Search the `devtrack-realtime-poc` runtime logs for `realtime.` to read them.

## 7. Rules from here

- **New dependency in `apps/api` or `apps/realtime`:** if the build fails with "Could not resolve" or "No loader is configured for .node files", add it to `external` **only** if it is native or optional, and say which in a comment. Otherwise it belongs in the bundle.
- **Don't reintroduce a plugin that marks packages external** to get around a build error. That brings back the startup cost silently, with no test failing.
- **Measure startup before and after a large dependency change:** start the built file and read `process.cpuUsage()` at "listening", or check the `realtime.instance_ready` log.
- **New Sentry integration or option:** keep `sentry-requests.spec.ts` green. A successful request must send nothing.

## 8. Still open

- **Realtime hosting.** Startup is now cheap, but each open tab reconnects every 4.5 minutes (Hobby's 300 s limit), so realtime cost still grows with users. Before launch, decide between staying on Vercel, a managed realtime provider, or a small always-on host (0007 already lists these).
- **Cron frequency.** `scheduled-jobs.yml` wakes the API every 10 minutes. Hourly would cut those invocations by ~83%. The outbox sweep mostly finds nothing, because events older than 15 minutes are marked stale anyway.
- **Website proxy.** `apps/website/src/proxy.ts` runs a function on every `/api/v1` request.

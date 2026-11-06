// Vercel entrypoint (decision record 0008). Vercel detects `server.*` at the project root and runs
// the API as one function. It loads dist/vercel/server.mjs: the API and the @devtrack/* packages
// bundled into a single ES module by scripts/build-esm.mjs (see there for why).
// Type-checking happens in `nest build` and CI, not here.

// Vercel's NestJS preset only accepts an entrypoint that imports NestJS.
import '@nestjs/core';
import './dist/vercel/server.mjs';

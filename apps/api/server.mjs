// Vercel entrypoint (decision record 0008). Vercel detects `server.*` at the project root and runs
// the API as one function. It loads the ES module build in dist/esm (scripts/build-esm.mjs),
// because NestJS 12 is ES-module-only and Vercel's runtime cannot require() it from CommonJS.
// Type-checking happens in `nest build` and CI, not here.

// Vercel's NestJS preset only accepts an entrypoint that imports NestJS.
import '@nestjs/core';
import './dist/esm/bootstrap.mjs';

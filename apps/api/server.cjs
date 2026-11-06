// Vercel entrypoint (decision record 0008). Vercel detects `server.*` at the project root and runs
// the API as one function. It loads the JavaScript that `nest build` already compiled and
// type-checked, so Vercel does not re-check the TypeScript sources with different settings.
//
// Vercel's NestJS preset accepts an entry only if it imports NestJS itself, hence this line
// (dist/bootstrap.js imports it too; Node loads the module once).
require('@nestjs/core');
require('./dist/bootstrap.js');

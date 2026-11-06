// Vercel entrypoint (decision record 0008). Vercel detects `server.*` at the project root and runs
// the API as one function. It loads the JavaScript that `nest build` already compiled and
// type-checked, so Vercel does not re-check the TypeScript sources with different settings.
require('./dist/bootstrap.js');

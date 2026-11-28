import { build } from 'esbuild';

// One self-contained, minified .mjs; Vercel must not rewrite it to CommonJS.
// Third-party packages are bundled too: loading them from node_modules file by file cost
// ~2 s of CPU on every new function instance, which Fluid bills as Active CPU.
await build({
  entryPoints: ['src/runtime.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  minify: true,
  sourcemap: true,
  // Optional native add-ons, loaded inside try/catch by ws, pg and @redis/client when installed.
  external: ['bufferutil', 'utf-8-validate', 'pg-native', '@node-rs/xxhash'],
  // Bundled CommonJS packages call require() for Node built-ins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

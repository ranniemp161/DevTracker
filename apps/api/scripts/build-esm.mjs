// Builds the API for Vercel as ONE ES module file: dist/vercel/server.mjs (decision record 0008).
//
// Why not `nest build` output (CommonJS) directly? Three things failed on Vercel, in turn:
// 1. NestJS 12 is ES-module-only, and Vercel's runtime refuses to require() it from CommonJS
//    (ERR_REQUIRE_ESM), although Node allows that locally.
// 2. Vercel's packager rewrites our own ES-module `.js` files to CommonJS, whatever their
//    package.json declares; Node then runs them as ES modules ("require is not defined").
// 3. That includes the @devtrack/* workspace packages (pnpm links them from the repo, so Vercel
//    treats them as project code), whose `export *` re-exports are lost ("does not provide an
//    export named 'ErrorCode'").
// So: SWC compiles src to ES modules with decorator metadata (Nest's dependency injection needs
// it; esbuild cannot emit it), then esbuild bundles that output together with the @devtrack/*
// packages into a single `.mjs` file. Third-party packages stay ordinary imports from
// node_modules, which Vercel leaves alone. Type-checking stays with `nest build`.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { transformFile } from '@swc/core';
import { build } from 'esbuild';

const srcDir = resolve('src');
const swcDir = resolve('dist/esm');
const outFile = resolve('dist/vercel/server.mjs');

async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (entry.name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(entry.name)) yield path;
  }
}

// 1. SWC: TypeScript -> ES modules, keeping decorator metadata.
await rm(swcDir, { recursive: true, force: true });
let count = 0;
for await (const file of sources(srcDir)) {
  const target = join(swcDir, relative(srcDir, file)).replace(/\.ts$/, '.mjs');
  const { code, map } = await transformFile(file, {
    swcrc: false,
    sourceMaps: true,
    outputPath: target,
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
      keepClassNames: true,
      // Absolute, so `resolveFully` can add the extension to every relative import.
      baseUrl: srcDir,
    },
    module: { type: 'es6', resolveFully: true, outFileExtension: 'mjs' },
  });
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${code}\n//# sourceMappingURL=${basename(target)}.map\n`);
  if (map) await writeFile(`${target}.map`, map);
  count++;
}

// 2. esbuild: bundle our code and the @devtrack/* packages; everything else stays external.
const externalThirdParty = {
  name: 'external-third-party',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      const isBare = !args.path.startsWith('.') && !isAbsolute(args.path);
      if (isBare && !args.path.startsWith('@devtrack/')) return { path: args.path, external: true };
      return undefined;
    });
  },
};
await build({
  entryPoints: [join(swcDir, 'bootstrap.mjs')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  keepNames: true,
  logLevel: 'warning',
  plugins: [externalThirdParty],
});
console.log(`build-esm: compiled ${count} files, bundled into ${relative(process.cwd(), outFile)}`);

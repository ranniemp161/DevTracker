// Builds an ES module copy of the API in dist/esm for Vercel (decision record 0008).
//
// NestJS 12 ships as ES modules only. `nest build` emits CommonJS, which loads Nest with
// require(); Node allows that locally, but Vercel's function runtime refuses it (ERR_REQUIRE_ESM).
// SWC compiles the same sources to ES modules, with decorator metadata for Nest's dependency
// injection, written as .mjs files (unambiguous ES modules, see below). Type-checking stays with `nest build`.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { transformFile } from '@swc/core';

const srcDir = resolve('src');
const outDir = resolve('dist/esm');

async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (entry.name.endsWith('.ts') && !/\.(spec|d)\.ts$/.test(entry.name)) yield path;
  }
}

let count = 0;
for await (const file of sources(srcDir)) {
  const outFile = join(outDir, relative(srcDir, file)).replace(/\.ts$/, '.mjs');
  const { code, map } = await transformFile(file, {
    swcrc: false,
    sourceMaps: true,
    outputPath: outFile,
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
      keepClassNames: true,
      // Absolute, so `resolveFully` can add the extension to every relative import.
      baseUrl: srcDir,
    },
    // .mjs is unambiguous: Vercel's packager rewrote ESM .js files to CommonJS (it follows the
    // package's CommonJS type, not a nested type marker), which then crashed at runtime.
    module: { type: 'es6', resolveFully: true, outFileExtension: 'mjs' },
  });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${code}\n//# sourceMappingURL=${basename(outFile)}.map\n`);
  if (map) await writeFile(`${outFile}.map`, map);
  count++;
}
console.log(`build-esm: compiled ${count} files to dist/esm`);

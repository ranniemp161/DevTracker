// Builds an ES module copy of the API in dist/esm for Vercel (decision record 0008).
//
// NestJS 12 ships as ES modules only. `nest build` emits CommonJS, which loads Nest with
// require(); Node allows that locally, but Vercel's function runtime refuses it (ERR_REQUIRE_ESM).
// SWC compiles the same sources to ES modules, with decorator metadata for Nest's dependency
// injection and `.js` extensions on relative imports. Type-checking stays with `nest build`.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
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
  const outFile = join(outDir, relative(srcDir, file)).replace(/\.ts$/, '.js');
  const { code, map } = await transformFile(file, {
    swcrc: false,
    sourceMaps: true,
    outputPath: outFile,
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2023',
      keepClassNames: true,
      // Absolute, so `resolveFully` can add `.js` to every relative import.
      baseUrl: srcDir,
    },
    module: { type: 'es6', resolveFully: true },
  });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${code}\n//# sourceMappingURL=${outFile.split(/[\/]/).pop()}.map\n`);
  if (map) await writeFile(`${outFile}.map`, map);
  count++;
}
// Mark the folder as ES modules (the package itself stays CommonJS for `nest build`).
await writeFile(join(outDir, 'package.json'), '{ "type": "module" }\n');
console.log(`build-esm: compiled ${count} files to dist/esm`);

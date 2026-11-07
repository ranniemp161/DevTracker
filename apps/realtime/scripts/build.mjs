import { isAbsolute } from 'node:path';
import { build } from 'esbuild';

// Inline workspace code into one .mjs; Vercel must not rewrite it to CommonJS.
await build({
  entryPoints: ['src/runtime.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  plugins: [
    {
      name: 'external-third-party',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === 'entry-point') return;
          const bare = !args.path.startsWith('.') && !isAbsolute(args.path);
          if (bare && !args.path.startsWith('@devtrack/'))
            return { path: args.path, external: true };
        });
      },
    },
  ],
});

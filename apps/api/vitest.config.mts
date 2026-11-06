import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  // SWC emits the decorator metadata NestJS dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});

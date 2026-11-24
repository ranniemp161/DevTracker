import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  timeout: 90_000,
  testMatch: '**/*.pw.ts',
  use: { baseURL: 'http://127.0.0.1:3184', channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3184',
    port: 3184,
    timeout: 120_000,
  },
});

import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { RealtimeIoAdapter } from './realtime-io.adapter';

afterEach(() => {
  vi.restoreAllMocks();
});

const adapterFor = (redisUrl: string | null) =>
  new RealtimeIoAdapter(
    {} as INestApplicationContext,
    {
      webOrigin: 'http://localhost:3000',
      realtime: { redisUrl },
    } as unknown as AppConfig,
  );

it('treats the in-process server as the transport when Redis is not configured', async () => {
  const adapter = adapterFor(null);
  await adapter.connect();
  expect(adapter.isTransportReady()).toBe(true);
});

it('gives up on an unreachable Redis within the startup limit, without logging its URL', async () => {
  const logged: string[] = [];
  for (const level of ['error', 'warn', 'log'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
  }
  // Port 1 refuses connections immediately; the password must never reach the logs.
  const adapter = adapterFor('redis://default:s3cret-token@127.0.0.1:1');

  const started = Date.now();
  await adapter.connect();
  expect(Date.now() - started).toBeLessThan(15_000);

  expect(adapter.isTransportReady()).toBe(false);
  expect(logged.some((m) => m.includes('serving without live updates'))).toBe(true);
  expect(logged.join('\n')).not.toMatch(/s3cret-token|127\.0\.0\.1/);
}, 20_000);

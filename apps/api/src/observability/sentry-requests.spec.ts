import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { sentryOptions } from './sentry';

/**
 * On Vercel the SDK flushes after every HTTP response. Each flush must have nothing to send for
 * a successful request, or every API request makes a call to Sentry. Errors still go out.
 */
describe('Sentry on Vercel', () => {
  const sent: string[] = [];
  const pending: Promise<unknown>[] = [];
  const requestContext = Symbol.for('@vercel/request-context');
  const globals = globalThis as Record<symbol, unknown>;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    globals[requestContext] = {
      get: () => ({ waitUntil: (task: Promise<unknown>) => pending.push(task) }),
    };
    Sentry.init({
      ...sentryOptions({
        sentry: { dsn: 'https://public@o0.ingest.sentry.io/1', environment: 'test', release: null },
      } as AppConfig),
      transport: (options) =>
        Sentry.createTransport(options, async (request) => {
          sent.push(String(request.body));
          return { statusCode: 200 };
        }),
    });
    server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await Sentry.close();
    delete process.env.VERCEL;
    delete globals[requestContext];
  });

  async function settle() {
    await Promise.all(pending.splice(0));
    await Sentry.flush(2000);
  }

  it('sends nothing for successful requests', async () => {
    for (let i = 0; i < 3; i++) await (await fetch(url)).text();
    await settle();

    expect(pending).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it('still sends errors', async () => {
    Sentry.captureException(new Error('boom'));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"type":"event"');
    expect(sent[0]).not.toMatch(/"type":"(sessions|client_report)"/);
  });
});

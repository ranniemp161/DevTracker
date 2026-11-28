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
        // A release is always set in production (the commit SHA); it turns on process sessions.
        sentry: {
          dsn: 'https://public@o0.ingest.sentry.io/1',
          environment: 'test',
          release: 'test-release',
        },
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

    // Item types of every envelope sent, e.g. [['event']], so a failure shows what leaked.
    // An envelope is a header line, then an item header line and a payload line per item.
    const types = sent.map((body) =>
      body
        .split('\n')
        .filter((_line, index) => index % 2 === 1)
        .map((line) => (JSON.parse(line) as { type: string }).type),
    );
    expect(types).toEqual([['event']]);
  });
});

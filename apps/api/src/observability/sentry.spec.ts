import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { scrubEvent } from './sentry';

describe('scrubEvent', () => {
  it('removes cookies, secrets, bodies and query strings', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://api.example/api/v1/auth/github/callback?code=abc&state=xyz',
        query_string: 'code=abc&state=xyz',
        cookies: { devtrack_session: 'secret' },
        data: '{"password":"hunter2"}',
        headers: {
          Authorization: 'Bearer cron',
          cookie: 'devtrack_session=secret',
          'X-Hub-Signature-256': 'sha256=abc',
          'user-agent': 'Mozilla',
        },
      },
      user: { id: 'u1', email: 'ada@example.com', ip_address: '1.2.3.4' },
    } as ErrorEvent);

    expect(event.request).toEqual({
      url: 'https://api.example/api/v1/auth/github/callback',
      headers: { 'user-agent': 'Mozilla' },
    });
    expect(event.user).toEqual({ id: 'u1' });
    expect(JSON.stringify(event)).not.toMatch(/secret|hunter2|abc|xyz|ada@|1\.2\.3\.4/);
  });
});

import { CLIENT_IP_PATH_PREFIXES } from '@devtrack/types';
// The docs call it unstable_doesProxyMatch; this Next.js version exports the old name.
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config } from './proxy';

const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });

describe('proxy matcher', () => {
  it('runs on every path where the API reads the client IP', () => {
    for (const prefix of CLIENT_IP_PATH_PREFIXES) {
      expect(runsOn(`${prefix}login`), prefix).toBe(true);
      expect(runsOn(`${prefix}requests/abc/attachments/1/complete`), prefix).toBe(true);
    }
    expect(config.matcher).toHaveLength(CLIENT_IP_PATH_PREFIXES.length);
  });

  it('skips ordinary API traffic and pages', () => {
    for (const url of [
      '/api/v1/workspaces/w1/chat/unread',
      '/api/v1/projects/p1/tasks',
      '/api/v1/notifications/unread-count',
      '/api/v1/realtime/token',
      '/projects/p1',
    ]) {
      expect(runsOn(url), url).toBe(false);
    }
  });
});

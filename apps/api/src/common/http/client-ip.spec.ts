import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp, clientIpMiddleware } from './request-context';

const SECRET = 's'.repeat(32);

function run(secret: string | null, headers: Record<string, string>): string {
  const req = {
    ip: '10.0.0.1',
    socket: {},
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  clientIpMiddleware(secret)(req, {} as never, () => undefined);
  return clientIp(req);
}

describe('clientIpMiddleware', () => {
  it('trusts the forwarded IP only with the right proxy secret', () => {
    const forwarded = { 'x-devtrack-client-ip': '203.0.113.7' };
    expect(run(SECRET, { ...forwarded, 'x-devtrack-proxy-secret': SECRET })).toBe('203.0.113.7');
    expect(run(SECRET, { ...forwarded, 'x-devtrack-proxy-secret': 'x'.repeat(32) })).toBe(
      '10.0.0.1',
    );
    expect(run(SECRET, forwarded)).toBe('10.0.0.1');
    expect(run(null, { ...forwarded, 'x-devtrack-proxy-secret': SECRET })).toBe('10.0.0.1');
  });

  it('ignores values that are not IP addresses', () => {
    expect(
      run(SECRET, { 'x-devtrack-client-ip': 'evil, 1.2.3.4', 'x-devtrack-proxy-secret': SECRET }),
    ).toBe('10.0.0.1');
    expect(
      run(SECRET, { 'x-devtrack-client-ip': '2001:db8::1', 'x-devtrack-proxy-secret': SECRET }),
    ).toBe('2001:db8::1');
  });
});

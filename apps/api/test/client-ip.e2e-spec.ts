import { afterAll, beforeAll, describe, it } from 'vitest';
import { createTestApp, TEST_PROXY_SECRET, VALID_PASSWORD, type TestApp } from './utils/test-app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

let n = 0;
const register = (headers: Record<string, string>) => {
  n++;
  return t
    .http()
    .post('/api/v1/auth/register')
    .set(headers)
    .send({ email: `ip${n}@example.com`, username: `ip-user-${n}`, password: VALID_PASSWORD });
};
const via = (ip: string) => ({
  'x-devtrack-client-ip': ip,
  'x-devtrack-proxy-secret': TEST_PROXY_SECRET,
});

describe('rate limits behind the website proxy', () => {
  it('counts each forwarded client separately, and ignores spoofed headers', async () => {
    // registerPerIp allows 20 per hour.
    for (let i = 0; i < 20; i++) await register(via('203.0.113.10')).expect(201);
    await register(via('203.0.113.10')).expect(429);

    // Another user behind the same proxy is unaffected.
    await register(via('203.0.113.20')).expect(201);

    // A browser cannot pick its own IP without the proxy secret: these count against the
    // connection's real address, not 203.0.113.30.
    const spoofed = { 'x-devtrack-client-ip': '203.0.113.30', 'x-devtrack-proxy-secret': 'nope' };
    for (let i = 0; i < 20; i++) await register(spoofed).expect(201);
    await register({ 'x-devtrack-client-ip': '203.0.113.31' }).expect(429);
    // ...while 203.0.113.30 itself, properly forwarded, still has its full allowance.
    await register(via('203.0.113.30')).expect(201);
  });
});

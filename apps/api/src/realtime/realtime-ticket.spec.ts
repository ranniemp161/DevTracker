import { describe, expect, it } from 'vitest';
import { issueTicket, TICKET_TTL_MS, verifyTicket } from './realtime-ticket';

const secret = 'x'.repeat(32);
const claims = { sid: 'session-1', uid: 'user-1' };

describe('realtime tickets', () => {
  it('round-trips claims until they expire', () => {
    const now = 1_800_000_000_000;
    const { token, expiresAt } = issueTicket(secret, claims, now);
    expect(expiresAt.getTime()).toBe(now + TICKET_TTL_MS);
    expect(verifyTicket(secret, token, now + 1000)).toMatchObject(claims);
    expect(verifyTicket(secret, token, now + TICKET_TTL_MS)).toBeNull();
  });

  it('rejects tampered, foreign and malformed tickets', () => {
    const { token } = issueTicket(secret, claims);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...claims, uid: 'user-2', exp: Date.now() + 9e9 }),
    ).toString('base64url');
    expect(verifyTicket(secret, `${forged}.${sig}`)).toBeNull();
    expect(verifyTicket('y'.repeat(32), token)).toBeNull();
    expect(verifyTicket(secret, `${body}`)).toBeNull();
    expect(verifyTicket(secret, `${token}.extra`)).toBeNull();
    expect(verifyTicket(secret, 42)).toBeNull();
    expect(verifyTicket(secret, undefined)).toBeNull();
  });
});

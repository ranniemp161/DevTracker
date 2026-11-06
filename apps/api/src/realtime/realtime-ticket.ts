import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a connection ticket can be used to open a socket. */
export const TICKET_TTL_MS = 60 * 1000;

export interface TicketClaims {
  /** Session ID: re-checked on connect, so a revoked session cannot connect. */
  sid: string;
  uid: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/**
 * Short-lived, HMAC-signed connection tickets (decision record 0007). The browser fetches one
 * through the same-origin API proxy (cookie-authenticated) and presents it when it opens the
 * socket, which connects to the API origin directly where the session cookie is not sent.
 */
export function issueTicket(secret: string, claims: Omit<TicketClaims, 'exp'>, now = Date.now()) {
  const body: TicketClaims = { ...claims, exp: now + TICKET_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  return { token: `${encoded}.${sign(secret, encoded)}`, expiresAt: new Date(body.exp) };
}

export function verifyTicket(
  secret: string,
  token: unknown,
  now = Date.now(),
): TicketClaims | null {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, encoded), 'base64url');
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TicketClaims;
    if (typeof claims.sid !== 'string' || typeof claims.uid !== 'string') return null;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

function sign(secret: string, encoded: string): string {
  return createHmac('sha256', secret).update(`realtime-ticket:${encoded}`).digest('base64url');
}

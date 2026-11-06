import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies GitHub's `X-Hub-Signature-256` header (`sha256=<hex>`) against the raw request
 * body, in constant time (architecture §11.5).
 */
export function verifyWebhookSignature(
  secret: string,
  body: Buffer,
  header: string | undefined,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** The header value GitHub would send for `body` (used by tests and tooling). */
export function signWebhookBody(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

import { describe, expect, it } from 'vitest';
import { signWebhookBody, verifyWebhookSignature } from './webhook-signature';

describe('verifyWebhookSignature', () => {
  const secret = "It's a Secret to Everybody";
  const body = Buffer.from('Hello, World!');

  it("matches GitHub's documented example", () => {
    // https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries
    const header = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    expect(signWebhookBody(secret, body)).toBe(header);
    expect(verifyWebhookSignature(secret, body, header)).toBe(true);
  });

  it.each([
    ['a missing header', undefined],
    [
      'a header without the sha256= prefix',
      '757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
    ],
    ['a truncated signature', 'sha256=757107ea'],
    ['a signature that is not hex', 'sha256=zz'],
    ['a signature for another secret', signWebhookBody('another secret', body)],
  ])('rejects %s', (_label, header) => {
    expect(verifyWebhookSignature(secret, body, header)).toBe(false);
  });

  it('rejects a modified body', () => {
    const header = signWebhookBody(secret, body);
    expect(verifyWebhookSignature(secret, Buffer.from('Hello, World?'), header)).toBe(false);
  });
});

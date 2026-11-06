import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppJwt } from './github-app.client';

describe('createAppJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('signs an RS256 JWT GitHub accepts: backdated iat, exp within 10 minutes, iss = app ID', () => {
    const now = Date.UTC(2026, 10, 6, 12, 0, 0);
    const jwt = createAppJwt('12345', pem, now);
    const [header, payload, signature] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(10 * 60);
    expect(claims.exp).toBeGreaterThan(now / 1000);

    const valid = verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature!, 'base64url'),
    );
    expect(valid).toBe(true);
  });
});

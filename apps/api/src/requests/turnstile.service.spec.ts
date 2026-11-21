import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/app-config';
import { TurnstileVerifier } from './turnstile.service';

const verifier = (config: Partial<AppConfig>) =>
  new TurnstileVerifier({
    isProduction: true,
    turnstileSecretKey: 'secret',
    ...config,
  } as AppConfig);

const answer = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('TurnstileVerifier logging', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs a missing production secret once and rejects', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const v = verifier({ turnstileSecretKey: null });
    expect(await v.verify('token', '203.0.113.1')).toBe(false);
    expect(await v.verify('token', '203.0.113.1')).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toContain('TURNSTILE_SECRET_KEY');
  });

  it('skips the check without logging outside production', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(
      await verifier({ isProduction: false, turnstileSecretKey: null }).verify(undefined, 'x'),
    ).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it("logs Cloudflare's error codes, as an error when the secret is wrong", async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    answer({ success: false, 'error-codes': ['invalid-input-secret'] });
    expect(await verifier({}).verify('tok-123', '203.0.113.1')).toBe(false);
    expect(error.mock.calls[0]![0]).toContain('invalid-input-secret');

    answer({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await verifier({}).verify('tok-123', '203.0.113.1')).toBe(false);
    expect(warn.mock.calls[0]![0]).toContain('timeout-or-duplicate');

    // Never the token or the visitor's IP.
    const logged = [...error.mock.calls, ...warn.mock.calls].flat().join(' ');
    expect(logged).not.toContain('tok-123');
    expect(logged).not.toContain('203.0.113.1');
  });

  it('accepts a successful check without logging', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    answer({ success: true });
    expect(await verifier({}).verify('tok', 'ip')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

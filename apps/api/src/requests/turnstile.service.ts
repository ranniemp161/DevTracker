import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare error codes that mean our configuration is wrong rather than the visitor failing
 * the check. Logged as errors so a misconfigured secret is obvious in the logs.
 */
const CONFIG_ERROR_CODES = new Set(['missing-input-secret', 'invalid-input-secret']);

/** Server-side Cloudflare Turnstile check for public request forms (decision record 0016). */
@Injectable()
export class TurnstileVerifier {
  private readonly logger = new Logger(TurnstileVerifier.name);
  private warnedMissingSecret = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async verify(token: string | undefined, ip: string): Promise<boolean> {
    const secret = this.config.turnstileSecretKey;
    // Without a secret the check is skipped, which configuration allows only outside production.
    if (!secret) {
      if (this.config.isProduction && !this.warnedMissingSecret) {
        this.warnedMissingSecret = true;
        this.logger.error(
          'TURNSTILE_SECRET_KEY is not set on the API, so every request-form submission is rejected.',
        );
      }
      return !this.config.isProduction;
    }
    if (!token) return false;
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`Turnstile siteverify answered HTTP ${res.status}.`);
        return false;
      }
      const body = (await res.json()) as { success?: boolean; 'error-codes'?: unknown };
      if (body.success === true) return true;
      // Only Cloudflare's codes are logged, never the token or the visitor's IP.
      const codes = Array.isArray(body['error-codes'])
        ? body['error-codes'].filter((c): c is string => typeof c === 'string')
        : [];
      const message = `Turnstile check failed: ${codes.join(', ') || 'no error code'}.`;
      if (codes.some((c) => CONFIG_ERROR_CODES.has(c))) {
        this.logger.error(`${message} Check TURNSTILE_SECRET_KEY on the API.`);
      } else {
        this.logger.warn(message);
      }
      return false;
    } catch (err) {
      this.logger.warn(`Turnstile verification failed: ${(err as Error).name}`);
      return false;
    }
  }
}

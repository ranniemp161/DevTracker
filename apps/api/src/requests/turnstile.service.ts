import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Server-side Cloudflare Turnstile check for public request forms (decision record 0016). */
@Injectable()
export class TurnstileVerifier {
  private readonly logger = new Logger(TurnstileVerifier.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async verify(token: string | undefined, ip: string): Promise<boolean> {
    const secret = this.config.turnstileSecretKey;
    // Without a secret the check is skipped, which configuration allows only outside production.
    if (!secret) return !this.config.isProduction;
    if (!token) return false;
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    } catch (err) {
      this.logger.warn(`Turnstile verification failed: ${(err as Error).name}`);
      return false;
    }
  }
}

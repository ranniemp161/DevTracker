import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Cookie policy (architecture §5/§14): HttpOnly, SameSite=Lax, Secure over HTTPS, Path=/.
 * Over HTTPS the `__Host-` prefix is used, which browsers only accept for Secure,
 * host-only, Path=/ cookies — so a sibling subdomain cannot plant or overwrite them.
 */
@Injectable()
export class AuthCookiesService {
  readonly sessionCookie: string;
  readonly oauthStateCookie: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const prefix = config.secureCookies ? '__Host-' : '';
    this.sessionCookie = `${prefix}devtrack_session`;
    this.oauthStateCookie = `${prefix}devtrack_oauth_state`;
  }

  private base(): CookieOptions {
    return { httpOnly: true, secure: this.config.secureCookies, sameSite: 'lax', path: '/' };
  }

  readSession(req: Request): string | undefined {
    return readCookie(req, this.sessionCookie);
  }

  setSession(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.sessionCookie, token, { ...this.base(), expires: expiresAt });
  }

  clearSession(res: Response): void {
    res.clearCookie(this.sessionCookie, this.base());
  }

  readOAuthState(req: Request): string | undefined {
    return readCookie(req, this.oauthStateCookie);
  }

  /** Lax (not Strict) so the cookie is sent on the top-level redirect back from GitHub. */
  setOAuthState(res: Response, state: string): void {
    res.cookie(this.oauthStateCookie, state, { ...this.base(), maxAge: OAUTH_STATE_TTL_MS });
  }

  clearOAuthState(res: Response): void {
    res.clearCookie(this.oauthStateCookie, this.base());
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const value: unknown = req.cookies?.[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
}

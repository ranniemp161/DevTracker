import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import type { Session } from '../../auth/sessions.service';
import type { User } from '../../users/users.service';
import { safeEqual } from '../crypto/tokens';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      /** The real client IP when forwarded by the trusted website proxy. */
      clientIp?: string;
      /** Set by AuthGuard on authenticated routes. */
      auth?: { user: User; session: Session };
    }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assigns a request ID for log correlation (architecture §15). An incoming `x-request-id`
 * is reused only if it is a UUID, so clients cannot inject arbitrary text into logs.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && UUID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** Best-effort client IP (respects the configured `trust proxy` setting). */
export function clientIp(req: Request): string {
  return req.clientIp ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * Resolves the client IP once per request (decision record 0008). Behind the website's proxy,
 * `x-devtrack-client-ip` is trusted only when `x-devtrack-proxy-secret` matches
 * `WEB_PROXY_SECRET`; otherwise Express's `req.ip` (with `trust proxy`) is used.
 */
export function clientIpMiddleware(proxySecret: string | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const forwarded = req.header('x-devtrack-client-ip');
    const presented = req.header('x-devtrack-proxy-secret');
    if (
      proxySecret &&
      forwarded &&
      presented &&
      isIP(forwarded) !== 0 &&
      safeEqual(presented, proxySecret)
    ) {
      req.clientIp = forwarded;
    }
    next();
  };
}

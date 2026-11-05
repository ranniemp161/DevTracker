import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Session } from '../../auth/sessions.service';
import type { User } from '../../users/users.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
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
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

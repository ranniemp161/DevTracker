import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ErrorCode } from '@devtrack/types';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { AppException } from '../errors/app.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence layered on SameSite=Lax cookies (architecture §14): state-changing requests
 * that carry browser provenance headers must come from the DevTrack website origin.
 * Requests without `Origin` (server-to-server, e.g. GitHub webhooks, curl) carry no
 * ambient browser cookies from a hostile page, so they pass to normal authentication.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.header('origin');
    const fetchSite = req.header('sec-fetch-site');
    const rejected = origin ? origin !== this.config.webOrigin : fetchSite === 'cross-site';
    if (rejected) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.CSRF_REJECTED,
        'Cross-site request rejected.',
      );
    }
    return true;
  }
}

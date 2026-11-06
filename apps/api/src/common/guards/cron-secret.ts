import type { Request } from 'express';
import type { AppConfig } from '../../config/app-config';
import { safeEqual } from '../crypto/tokens';
import { AppException } from '../errors/app.exception';

/**
 * Authorizes scheduled jobs (`Authorization: Bearer $CRON_SECRET`). Without a configured
 * secret the job routes do not exist (404).
 */
export function requireCronSecret(config: AppConfig, req: Request): void {
  const secret = config.cronSecret;
  if (!secret) throw AppException.notFound();
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token || !safeEqual(token, secret)) throw AppException.unauthenticated();
}

import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { raw } from 'express';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/http/request-context';
import type { AppConfig } from './config/app-config';

export const API_PREFIX = 'api/v1';

/** Path of the public GitHub webhook endpoint (architecture §11.4). */
export const GITHUB_WEBHOOK_PATH = `/${API_PREFIX}/webhooks/github`;

/** HTTP-level setup shared by `main.ts` and the integration tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(helmet());
  // GitHub signs the exact bytes it sends, so the webhook keeps its raw body (§11.5). This is
  // registered before Nest's JSON parser, which then skips the already-read body. Push payloads
  // can be large; GitHub caps deliveries at 25 MB.
  app.use(GITHUB_WEBHOOK_PATH, raw({ type: () => true, limit: '25mb' }));
  app.use(cookieParser());
  // The browser normally reaches the API same-origin through the website's /api rewrite;
  // CORS is still restricted to the website origin (strict allowlist, architecture §14).
  app.enableCors({ origin: [config.webOrigin], credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

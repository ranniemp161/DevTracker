import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestIdMiddleware } from './common/http/request-context';
import type { AppConfig } from './config/app-config';

export const API_PREFIX = 'api/v1';

/** HTTP-level setup shared by `main.ts` and the integration tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  // The browser normally reaches the API same-origin through the website's /api rewrite;
  // CORS is still restricted to the website origin (strict allowlist, architecture §14).
  app.enableCors({ origin: [config.webOrigin], credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

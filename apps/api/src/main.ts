import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { configureApp, setupRealtime } from './configure-app';

// Local development reads the repository-root `.env`; deployed environments inject variables.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await setupRealtime(app, config);
  await app.listen(config.port);
  new Logger('Bootstrap').log(`DevTrack API listening on port ${config.port}`);
}

void bootstrap();

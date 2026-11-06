import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OutboxPublisher } from './outbox-publisher.service';

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * After a successful write request (including GitHub webhooks), flush the outbox so clients
 * see the change within moments. Business data and outbox rows are already committed by then.
 * On Vercel, `waitUntil` keeps the function alive until the flush finishes after the response
 * is sent; elsewhere the promise simply runs in the background.
 */
@Injectable()
export class PublishAfterResponseInterceptor implements NestInterceptor {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly publisher: OutboxPublisher,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.config.realtime.publishAfterResponse) {
      return next.handle();
    }
    const method = context.switchToHttp().getRequest<Request>().method;
    if (READ_ONLY.has(method)) return next.handle();
    return next.handle().pipe(tap({ complete: () => waitUntil(this.publisher.flushQuietly()) }));
  }
}

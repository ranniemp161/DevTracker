import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiPaginated, ApiSuccess } from '@devtrack/types';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { Paginated } from '../http/paginated';

/**
 * Wraps controller return values as `{ data, meta: { requestId } }`, or
 * `{ data, meta: { requestId, nextCursor, hasMore } }` for `Paginated` results (architecture §9).
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (res.statusCode === 204) return undefined;
        if (data instanceof Paginated) {
          return {
            data: data.items,
            meta: {
              requestId: req.requestId,
              nextCursor: data.nextCursor,
              hasMore: data.nextCursor !== null,
            },
          } satisfies ApiPaginated<unknown>;
        }
        return {
          data: data ?? null,
          meta: { requestId: req.requestId },
        } satisfies ApiSuccess<unknown>;
      }),
    );
  }
}

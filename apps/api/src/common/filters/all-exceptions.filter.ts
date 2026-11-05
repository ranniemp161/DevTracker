import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, type ApiErrorBody } from '@devtrack/types';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

const GENERIC_MESSAGES: Partial<Record<number, string>> = {
  400: 'The request body is invalid.',
  401: 'Authentication is required.',
  403: 'You do not have access to this resource.',
  404: 'The resource was not found.',
  405: 'Method not allowed.',
  413: 'The request body is too large.',
  415: 'Unsupported content type.',
  429: 'Too many requests. Please try again later.',
};

/**
 * Centralized error envelope (architecture §9). Unexpected errors are logged with the
 * request ID and returned as a generic 500 — internals never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody['error'];

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.details ? { details: exception.details } : {}),
      };
      for (const [name, value] of Object.entries(exception.headers ?? {})) {
        res.setHeader(name, value);
      }
    } else if (exception instanceof HttpException || isClientHttpError(exception)) {
      // Framework/parser errors (unknown route, malformed JSON, body too large, ...).
      // Their messages can contain internals, so clients get a fixed message per status.
      status = exception instanceof HttpException ? exception.getStatus() : exception.status;
      body = {
        code:
          STATUS_TO_CODE[status] ??
          (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR),
        message:
          GENERIC_MESSAGES[status] ??
          (status >= 500 ? 'An unexpected error occurred.' : 'The request is invalid.'),
        requestId,
      };
    } else {
      body = {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred.',
        requestId,
      };
    }

    if (status >= 500) {
      // Log the error itself, never the request body (it may contain passwords/tokens).
      this.logger.error(
        { requestId, method: req.method, path: req.path, status },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (res.headersSent) return;
    res.status(status).json({ error: body } satisfies ApiErrorBody);
  }
}

function isClientHttpError(e: unknown): e is { status: number } {
  if (!e || typeof e !== 'object') return false;
  const status = (e as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

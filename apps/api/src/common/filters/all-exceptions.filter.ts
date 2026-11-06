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
import { reportError } from '../../observability/sentry';
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
    if (host.getType() !== 'http') {
      // WebSocket handlers answer through acknowledgements and catch expected errors
      // themselves; anything reaching here is unexpected. Log it; never write an HTTP reply.
      this.logger.error(`Unhandled ${host.getType()} error`, describeError(exception));
      reportError(exception, { context: host.getType() });
      return;
    }
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
        describeError(exception),
      );
      reportError(exception, {
        requestId,
        method: req.method,
        path: req.route?.path ?? req.path,
        status,
      });
    }

    if (res.headersSent) return;
    res.status(status).json({ error: body } satisfies ApiErrorBody);
  }
}

/**
 * Stack trace plus the `cause` chain (Drizzle wraps driver errors, hiding e.g. a connection
 * timeout behind "Failed query"). Query parameters are stripped: they can contain emails,
 * password hashes and token hashes, which must never reach logs (architecture §14).
 */
export function describeError(exception: unknown): string {
  const parts: string[] = [];
  let current: unknown = exception;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      const text = redactQueryParams(
        depth === 0 ? (current.stack ?? current.message) : current.message,
      );
      parts.push(
        depth === 0 ? text : `Caused by${typeof code === 'string' ? ` [${code}]` : ''}: ${text}`,
      );
      current = current.cause;
    } else {
      parts.push(depth === 0 ? String(current) : `Caused by: ${String(current)}`);
      break;
    }
  }
  return parts.join('\n');
}

function redactQueryParams(text: string): string {
  return text.replace(/^params: .*$/gm, 'params: [redacted]');
}

function isClientHttpError(e: unknown): e is { status: number } {
  if (!e || typeof e !== 'object') return false;
  const status = (e as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

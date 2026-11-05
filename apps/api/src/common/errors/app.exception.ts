import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, type ApiFieldError } from '@devtrack/types';

/**
 * The single exception type for expected failures. The global filter turns it into
 * the `{ error: { code, message, requestId } }` envelope (architecture §9).
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ApiFieldError[],
    /** Extra response headers, e.g. `Retry-After`. */
    readonly headers?: Record<string, string>,
  ) {
    super(message, status);
  }

  static validation(details: ApiFieldError[]) {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'The request is invalid.',
      details,
    );
  }

  static unauthenticated(message = 'Authentication is required.') {
    return new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'You do not have access to this resource.') {
    return new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message);
  }

  static notFound(message = 'The resource was not found.') {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message);
  }
}

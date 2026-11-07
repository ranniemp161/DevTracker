import type { PipeTransform } from '@nestjs/common';
import { AppException } from '../errors/app.exception';

import { isUuid } from '@devtrack/server-core';
export { isUuid } from '@devtrack/server-core';

/**
 * Validates a UUID route parameter. A malformed ID is reported as 404 (not 400), so invalid
 * and nonexistent resources look identical to callers (architecture §6: no IDOR signals).
 */
export class UuidParamPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isUuid(value)) throw AppException.notFound();
    return value.toLowerCase();
  }
}

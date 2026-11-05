import type { PipeTransform } from '@nestjs/common';
import { AppException } from '../errors/app.exception';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

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

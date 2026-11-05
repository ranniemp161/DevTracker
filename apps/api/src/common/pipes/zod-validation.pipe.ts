import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppException } from '../errors/app.exception';

/** Validates and normalizes input with a shared `@devtrack/validators` schema. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw AppException.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
}

import { describe, expect, it } from 'vitest';
import { describeError } from './all-exceptions.filter';

describe('describeError', () => {
  it('includes the cause chain so wrapped driver errors are diagnosable', () => {
    const cause = Object.assign(new Error('connect ETIMEDOUT 35.177.159.226:5432'), {
      code: 'ETIMEDOUT',
    });
    const err = new Error('Failed query: select 1', { cause });
    const text = describeError(err);
    expect(text).toContain('Failed query: select 1');
    expect(text).toContain('Caused by [ETIMEDOUT]: connect ETIMEDOUT');
  });

  it('never logs query parameters (they can hold emails and password hashes)', () => {
    const err = new Error(
      'Failed query: insert into "users" ("email", "password_hash") values ($1, $2)\nparams: ada@example.com,$argon2id$v=19$secret',
    );
    const text = describeError(err);
    expect(text).toContain('params: [redacted]');
    expect(text).not.toContain('ada@example.com');
    expect(text).not.toContain('$argon2id$');
  });

  it('handles non-Error values', () => {
    expect(describeError('boom')).toBe('boom');
  });
});

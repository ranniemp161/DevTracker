import { createDatabase } from '@devtrack/database';
import { describe, expect, it, vi } from 'vitest';

describe('createDatabase', () => {
  it('survives an idle connection error instead of crashing the process', async () => {
    const onIdleConnectionError = vi.fn();
    // No query is made, so the URL is never contacted.
    const { pool } = createDatabase('postgresql://user:pass@127.0.0.1:1/none', {
      onIdleConnectionError,
    });
    const error = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

    // An EventEmitter with no 'error' listener throws here (and would kill the process).
    expect(() => pool.emit('error', error)).not.toThrow();
    expect(onIdleConnectionError).toHaveBeenCalledWith(error);
    await pool.end();
  });
});

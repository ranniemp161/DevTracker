import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://local/test',
  REALTIME_SECRET: 'test-only-secret-at-least-32-characters',
  WEB_ORIGIN: 'https://example.test',
  REDIS_URL: 'redis://localhost:6379',
};

it('requires production Redis and HTTPS and rejects missing secrets without logging values', () => {
  expect(loadConfig(valid).WEB_ORIGIN).toBe('https://example.test');
  expect(() => loadConfig({ ...valid, REDIS_URL: undefined })).toThrow('REDIS_URL');
  expect(() => loadConfig({ ...valid, NODE_ENV: undefined, REDIS_URL: undefined })).toThrow(
    'REDIS_URL',
  );
  expect(() => loadConfig({ ...valid, WEB_ORIGIN: 'http://example.test' })).toThrow('WEB_ORIGIN');
  expect(() => loadConfig({ ...valid, REALTIME_SECRET: undefined })).toThrow('REALTIME_SECRET');
  const credential = 'invalid-sensitive-credential';
  try {
    loadConfig({ ...valid, DATABASE_URL: credential });
  } catch (error) {
    expect(String(error)).toContain('DATABASE_URL');
    expect(String(error)).not.toContain(credential);
  }
});

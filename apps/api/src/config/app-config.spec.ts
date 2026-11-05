import { describe, expect, it } from 'vitest';
import { loadConfig } from './app-config';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost/db',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      webOrigin: 'http://localhost:3000',
      trustProxy: false,
      secureCookies: false,
      github: null,
      mail: { transport: 'console' },
    });
  });

  it('derives the GitHub callback URL from the website origin', () => {
    const config = loadConfig({
      ...base,
      GITHUB_OAUTH_CLIENT_ID: 'id',
      GITHUB_OAUTH_CLIENT_SECRET: 'secret',
    });
    expect(config.github?.callbackUrl).toBe('http://localhost:3000/api/v1/auth/github/callback');
  });

  it('requires GitHub client id and secret together', () => {
    expect(() => loadConfig({ ...base, GITHUB_OAUTH_CLIENT_ID: 'id' })).toThrow(
      /must be set together/,
    );
  });

  it('enables secure cookies for https origins and normalizes the origin', () => {
    const config = loadConfig({ ...base, WEB_ORIGIN: 'https://devtrack.example/some/path' });
    expect(config.webOrigin).toBe('https://devtrack.example');
    expect(config.secureCookies).toBe(true);
  });

  it('refuses console mail and non-https origins in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      /WEB_ORIGIN: must be https[\s\S]*MAIL_TRANSPORT: console transport is not allowed/,
    );
  });

  it('parses TRUST_PROXY hop counts and rejects nonsense', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'sometimes' })).toThrow(/TRUST_PROXY/);
  });

  it('lists every missing required variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*WEB_ORIGIN/);
  });
});

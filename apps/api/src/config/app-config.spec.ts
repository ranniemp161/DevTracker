import { generateKeyPairSync } from 'node:crypto';
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

describe('loadConfig: GitHub App', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const app = {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_SLUG: 'devtrack-test',
    GITHUB_APP_CLIENT_ID: 'Iv23li-client',
    GITHUB_APP_CLIENT_SECRET: 'app-secret',
  };

  it('is disabled when no GitHub App variables are set', () => {
    expect(loadConfig(base).githubApp).toBeNull();
  });

  it.each([
    ['raw PEM', pem],
    ['\n-escaped PEM', pem.trim().replace(/\n/g, '\n')],
    ['base64 PEM', Buffer.from(pem).toString('base64')],
  ])('accepts a %s private key', (_label, value) => {
    const config = loadConfig({ ...base, ...app, GITHUB_APP_PRIVATE_KEY: value });
    expect(config.githubApp).toMatchObject({ appId: '12345', slug: 'devtrack-test' });
    expect(config.githubApp?.privateKey).toContain('-----BEGIN RSA PRIVATE KEY-----');
  });

  it('requires every GitHub App variable together', () => {
    expect(() => loadConfig({ ...base, GITHUB_APP_ID: '12345' })).toThrow(
      /GitHub App variables must be set together/,
    );
  });

  it('rejects an invalid private key without echoing it', () => {
    let message = '';
    try {
      loadConfig({ ...base, ...app, GITHUB_APP_PRIVATE_KEY: 'not-a-key-SECRET' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/GITHUB_APP_PRIVATE_KEY: is not a valid PEM private key/);
    expect(message).not.toContain('SECRET');
  });
});

describe('loadConfig: webhook and cron secrets', () => {
  it('reads both secrets and requires at least 16 characters', () => {
    const config = loadConfig({
      ...base,
      GITHUB_APP_WEBHOOK_SECRET: 'w'.repeat(16),
      CRON_SECRET: 'c'.repeat(32),
    });
    expect(config.githubWebhookSecret).toBe('w'.repeat(16));
    expect(config.cronSecret).toBe('c'.repeat(32));
    expect(loadConfig(base)).toMatchObject({ githubWebhookSecret: null, cronSecret: null });
    expect(() => loadConfig({ ...base, CRON_SECRET: 'short' })).toThrow(/CRON_SECRET/);
  });
});

describe('loadConfig: realtime', () => {
  it('uses a per-process key and no Redis in development', () => {
    const config = loadConfig(base);
    expect(config.realtime.secret.length).toBeGreaterThanOrEqual(32);
    expect(config.realtime).toMatchObject({ redisUrl: null, publishAfterResponse: true });
    expect(loadConfig(base).realtime.secret).not.toBe(config.realtime.secret);
  });

  it('validates REALTIME_SECRET and REDIS_URL', () => {
    expect(() => loadConfig({ ...base, REALTIME_SECRET: 'short' })).toThrow(/REALTIME_SECRET/);
    expect(() => loadConfig({ ...base, REDIS_URL: 'http://x' })).toThrow(/REDIS_URL/);
    const config = loadConfig({
      ...base,
      REALTIME_SECRET: 's'.repeat(32),
      REDIS_URL: 'rediss://default:pw@example.upstash.io:6379',
    });
    expect(config.realtime).toMatchObject({
      secret: 's'.repeat(32),
      redisUrl: 'rediss://default:pw@example.upstash.io:6379',
    });
  });

  it('requires both in production', () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://devtrack.example' }),
    ).toThrow(
      /REALTIME_SECRET: is required in production[\s\S]*REDIS_URL: is required in production/,
    );
  });
});

import { createPrivateKey, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  /** Public website origin, e.g. `https://devtrack.example.com`. */
  webOrigin: string;
  /** Express `trust proxy` value. */
  trustProxy: number | boolean;
  /** Secure cookies (and the `__Host-` prefix) whenever the site is served over HTTPS. */
  secureCookies: boolean;
  github: GithubOAuthConfig | null;
  /** The GitHub App (repository access, M5). Separate from OAuth login. */
  githubApp: GithubAppConfig | null;
  /** HMAC secret for `POST /webhooks/github` (M6). Null: the endpoint answers 503. */
  githubWebhookSecret: string | null;
  /** Bearer secret for the scheduled delivery-retry job (M6). Null: the job is disabled. */
  cronSecret: string | null;
  /** Shared with the website's proxy so the API can trust its client-IP header (M8). */
  webProxySecret: string | null;
  /** Error tracking (M8). Null DSN: disabled. */
  sentry: { dsn: string | null; environment: string; release: string | null };
  /** Socket.IO (M7, decision record 0007). */
  realtime: RealtimeConfig;
  mail: MailConfig;
}

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

/** GitHub App credentials (architecture §11). Never sent to the browser or logged. */
export interface GithubAppConfig {
  appId: string;
  /** URL slug: `https://github.com/apps/<slug>`. */
  slug: string;
  /** The App's own OAuth client, used to verify who completed an installation. */
  clientId: string;
  clientSecret: string;
  /** PEM-encoded RSA private key, used to sign App JWTs. */
  privateKey: string;
}

/** Console prints emails (development only). Resend is the production provider (0008). */
export type MailConfig =
  { transport: 'console'; from: string } | { transport: 'resend'; from: string; apiKey: string };

export interface RealtimeConfig {
  /** HMAC key for short-lived connection tickets. */
  secret: string;
  /** Cross-instance broadcasting. Null: in-process only (single instance, development). */
  redisUrl: string | null;
  /** The server closes each connection after this long so the client re-authenticates. */
  maxConnectionMs: number;
  /**
   * Flush the outbox after each successful write request. Off in most tests, which assert on
   * unpublished rows; the realtime tests turn it on.
   */
  publishAfterResponse: boolean;
}

/**
 * Below Vercel Hobby's 300 s function limit, so connections end on our terms (with a
 * reconnect) rather than being cut by the platform.
 */
export const REALTIME_MAX_CONNECTION_MS = 4.5 * 60 * 1000;

const GITHUB_APP_VARS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
] as const;

/**
 * Accepts the PEM as-is, with literal `\n` escapes (single-line .env values), or
 * base64-encoded. Returns undefined when it is not a usable private key.
 */
export function normalizePrivateKey(raw: string): string | undefined {
  let pem = raw.replace(/\\n/g, '\n').trim();
  if (!pem.includes('-----BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
  try {
    createPrivateKey(pem);
    return pem;
  } catch {
    return undefined;
  }
}

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().optional(),
    // Set by hosting platforms (e.g. Vercel); API_PORT wins when both are set.
    PORT: z.coerce.number().int().positive().optional(),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    WEB_ORIGIN: z.url().transform((v) => new URL(v).origin),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((v, ctx) => {
        if (v === 'true') return true;
        if (v === 'false') return false;
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) return n;
        ctx.addIssue({ code: 'custom', message: 'TRUST_PROXY must be true, false or a hop count' });
        return z.NEVER;
      }),
    GITHUB_OAUTH_CLIENT_ID: optionalString,
    GITHUB_OAUTH_CLIENT_SECRET: optionalString,
    GITHUB_OAUTH_CALLBACK_URL: optionalString.pipe(z.url().optional()),
    GITHUB_APP_ID: optionalString.pipe(z.string().regex(/^\d+$/).optional()),
    GITHUB_APP_SLUG: optionalString.pipe(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .optional(),
    ),
    GITHUB_APP_CLIENT_ID: optionalString,
    GITHUB_APP_CLIENT_SECRET: optionalString,
    GITHUB_APP_PRIVATE_KEY: optionalString,
    GITHUB_APP_WEBHOOK_SECRET: optionalString.pipe(
      z.string().min(16, { error: 'must be at least 16 characters' }).optional(),
    ),
    CRON_SECRET: optionalString.pipe(
      z.string().min(16, { error: 'must be at least 16 characters' }).optional(),
    ),
    REALTIME_SECRET: optionalString.pipe(
      z.string().min(32, { error: 'must be at least 32 characters' }).optional(),
    ),
    REDIS_URL: optionalString.pipe(
      z
        .string()
        .regex(/^rediss?:\/\//, { error: 'must be a redis:// or rediss:// URL' })
        .optional(),
    ),
    MAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: optionalString,
    WEB_PROXY_SECRET: optionalString.pipe(
      z.string().min(32, { error: 'must be at least 32 characters' }).optional(),
    ),
    SENTRY_DSN: optionalString.pipe(z.url().optional()),
    // Set by Vercel: 'production', 'preview' or 'development'; the git commit SHA.
    VERCEL_ENV: optionalString,
    VERCEL_GIT_COMMIT_SHA: optionalString,
    MAIL_FROM: z.string().min(1).default('DevTrack <no-reply@devtrack.local>'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.WEB_ORIGIN.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_ORIGIN'],
          message: 'must be https in production',
        });
      }
      if (env.MAIL_TRANSPORT === 'console') {
        // Console mail prints verification/reset links to logs: never acceptable in production.
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_TRANSPORT'],
          message: 'console transport is not allowed in production (use resend)',
        });
      }
      if (env.GITHUB_APP_ID && !env.GITHUB_APP_WEBHOOK_SECRET) {
        // Without it, GitHub events can never be accepted.
        ctx.addIssue({
          code: 'custom',
          path: ['GITHUB_APP_WEBHOOK_SECRET'],
          message: 'is required in production when the GitHub App is configured',
        });
      }
      // Several function instances must share the ticket key and broadcast through Redis.
      if (!env.REALTIME_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['REALTIME_SECRET'],
          message: 'is required in production',
        });
      }
      if (!env.WEB_PROXY_SECRET) {
        // Without it every user shares the website's IP and its rate-limit buckets.
        ctx.addIssue({
          code: 'custom',
          path: ['WEB_PROXY_SECRET'],
          message: 'is required in production',
        });
      }
      if (!env.REDIS_URL) {
        ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'is required in production' });
      }
    }
    if (Boolean(env.GITHUB_OAUTH_CLIENT_ID) !== Boolean(env.GITHUB_OAUTH_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GITHUB_OAUTH_CLIENT_SECRET'],
        message: 'GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET must be set together',
      });
    }
    if (env.MAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'is required when MAIL_TRANSPORT=resend',
      });
    }
    const appVars = GITHUB_APP_VARS.filter((name) => Boolean(env[name]));
    if (appVars.length > 0 && appVars.length < GITHUB_APP_VARS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['GITHUB_APP_ID'],
        message: `GitHub App variables must be set together: ${GITHUB_APP_VARS.join(', ')}`,
      });
    }
    if (env.GITHUB_APP_PRIVATE_KEY && !normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY)) {
      // Never echo the value.
      ctx.addIssue({
        code: 'custom',
        path: ['GITHUB_APP_PRIVATE_KEY'],
        message: 'is not a valid PEM private key (raw, \\n-escaped or base64)',
      });
    }
  });

/** Parses and validates environment variables; throws with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.API_PORT ?? e.PORT ?? 4000,
    databaseUrl: e.DATABASE_URL,
    webOrigin: e.WEB_ORIGIN,
    trustProxy: e.TRUST_PROXY,
    secureCookies: e.WEB_ORIGIN.startsWith('https://'),
    github:
      e.GITHUB_OAUTH_CLIENT_ID && e.GITHUB_OAUTH_CLIENT_SECRET
        ? {
            clientId: e.GITHUB_OAUTH_CLIENT_ID,
            clientSecret: e.GITHUB_OAUTH_CLIENT_SECRET,
            callbackUrl:
              e.GITHUB_OAUTH_CALLBACK_URL ?? `${e.WEB_ORIGIN}/api/v1/auth/github/callback`,
          }
        : null,
    githubApp:
      e.GITHUB_APP_ID &&
      e.GITHUB_APP_SLUG &&
      e.GITHUB_APP_CLIENT_ID &&
      e.GITHUB_APP_CLIENT_SECRET &&
      e.GITHUB_APP_PRIVATE_KEY
        ? {
            appId: e.GITHUB_APP_ID,
            slug: e.GITHUB_APP_SLUG,
            clientId: e.GITHUB_APP_CLIENT_ID,
            clientSecret: e.GITHUB_APP_CLIENT_SECRET,
            privateKey: normalizePrivateKey(e.GITHUB_APP_PRIVATE_KEY)!,
          }
        : null,
    webProxySecret: e.WEB_PROXY_SECRET ?? null,
    sentry: {
      dsn: e.SENTRY_DSN ?? null,
      environment: e.VERCEL_ENV ?? e.NODE_ENV,
      release: e.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    githubWebhookSecret: e.GITHUB_APP_WEBHOOK_SECRET ?? null,
    cronSecret: e.CRON_SECRET ?? null,
    realtime: {
      // Development falls back to a per-process key: fine for a single local API process.
      secret: e.REALTIME_SECRET ?? randomBytes(32).toString('base64url'),
      redisUrl: e.REDIS_URL ?? null,
      maxConnectionMs: REALTIME_MAX_CONNECTION_MS,
      publishAfterResponse: true,
    },
    mail:
      e.MAIL_TRANSPORT === 'resend'
        ? { transport: 'resend', from: e.MAIL_FROM, apiKey: e.RESEND_API_KEY! }
        : { transport: 'console', from: e.MAIL_FROM },
  };
}

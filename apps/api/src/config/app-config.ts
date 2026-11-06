import { createPrivateKey } from 'node:crypto';
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
  mail: { transport: 'console'; from: string };
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
    API_PORT: z.coerce.number().int().positive().default(4000),
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
    MAIL_TRANSPORT: z.enum(['console']).default('console'),
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
          message:
            'console transport is not allowed in production (email provider is an open decision)',
        });
      }
    }
    if (Boolean(env.GITHUB_OAUTH_CLIENT_ID) !== Boolean(env.GITHUB_OAUTH_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GITHUB_OAUTH_CLIENT_SECRET'],
        message: 'GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET must be set together',
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
    port: e.API_PORT,
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
    mail: { transport: e.MAIL_TRANSPORT, from: e.MAIL_FROM },
  };
}

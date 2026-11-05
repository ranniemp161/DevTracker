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
  mail: { transport: 'console'; from: string };
}

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
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
    mail: { transport: e.MAIL_TRANSPORT, from: e.MAIL_FROM },
  };
}

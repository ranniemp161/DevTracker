import * as Sentry from '@sentry/nextjs';

/** Server-side error tracking for the website (no-op without NEXT_PUBLIC_SENTRY_DSN). */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    const { sentryOptions } = await import('./lib/sentry-options');
    Sentry.init(sentryOptions);
  }
}

export const onRequestError = Sentry.captureRequestError;

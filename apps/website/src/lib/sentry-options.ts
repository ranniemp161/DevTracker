import type { BrowserOptions } from '@sentry/nextjs';

/** Drops query strings and fragments: verification and invitation links carry `#token=...`. */
export function stripUrl(url: unknown): unknown {
  return typeof url === 'string' ? url.split(/[?#]/)[0] : url;
}

/**
 * Shared Sentry options for the website (decision record 0008): errors only, no personal data,
 * no URLs with tokens. Enabled only when `NEXT_PUBLIC_SENTRY_DSN` is set.
 */
export const sentryOptions: BrowserOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    urlQueryParams: false,
    httpHeaders: { deny: ['authorization', 'cookie', 'set-cookie'] },
  },
  beforeSend(event) {
    if (event.request) {
      event.request.url = stripUrl(event.request.url) as string | undefined;
      delete event.request.cookies;
      delete event.request.query_string;
      delete event.request.data;
    }
    delete event.user;
    return event;
  },
  beforeBreadcrumb(crumb) {
    if (crumb.data) {
      for (const key of ['url', 'from', 'to']) crumb.data[key] = stripUrl(crumb.data[key]);
    }
    return crumb;
  },
};

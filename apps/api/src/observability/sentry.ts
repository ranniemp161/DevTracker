import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import type { AppConfig } from '../config/app-config';

let enabled = false;

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-hub-signature-256'];

/**
 * Removes anything that could carry secrets or personal data before an event leaves the
 * process: cookies, auth/signature headers, request bodies and query strings (which hold OAuth
 * codes and states). Exported for tests.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split('?')[0];
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name];
      }
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}

/**
 * Error tracking (architecture §15, decision record 0008). Errors only: no tracing, no request
 * sessions, no client reports, no personal data, and `scrubEvent` as a second line of defence.
 * Exported for tests.
 */
export function sentryOptions(config: AppConfig): Sentry.NodeOptions {
  return {
    dsn: config.sentry.dsn ?? undefined,
    environment: config.sentry.environment,
    release: config.sentry.release ?? undefined,
    // Collect no personal data: no cookies, bodies, query strings or user info (Sentry 11).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      httpHeaders: { deny: SENSITIVE_HEADERS },
    },
    tracesSampleRate: 0,
    // On Vercel the SDK flushes after every response. With release-health sessions and client
    // reports on, each flush made a request to Sentry, i.e. one per API request. The process
    // session (started whenever a release is set) would also ride along with every error.
    sendClientReports: false,
    integrations: (defaults) => [
      ...defaults.filter(({ name }) => name !== 'Http' && name !== 'ProcessSession'),
      Sentry.httpIntegration({ sessions: false }),
    ],
    beforeSend: scrubEvent,
  };
}

/** Enabled only when `SENTRY_DSN` is set. */
export function initSentry(config: AppConfig): void {
  if (!config.sentry.dsn || enabled) return;
  Sentry.init(sentryOptions(config));
  enabled = true;
}

/** Reports an unexpected error with non-sensitive context. A no-op when Sentry is off. */
export function reportError(
  error: unknown,
  context: Record<string, string | number | null> = {},
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      if (value !== null) scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}

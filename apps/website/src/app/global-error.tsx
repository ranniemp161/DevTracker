'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/** Last-resort error page: reports render errors that escaped every other boundary. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-surface-sunken p-8 font-sans">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-fg-muted">
            The error has been reported{error.digest ? ` (reference ${error.digest})` : ''}.
          </p>
          <button
            type="button"
            onClick={reset}
            className="rounded-control bg-fg px-3.5 py-2 text-sm font-medium text-fg-on-inverse"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/sentry-options';

// Browser error tracking (no-op without NEXT_PUBLIC_SENTRY_DSN).
Sentry.init(sentryOptions);

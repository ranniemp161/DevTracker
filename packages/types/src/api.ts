/**
 * HTTP API envelope contracts (architecture §9 "API conventions").
 * Shared by the API (producer) and the website (consumer).
 */

export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiPaginated<T> {
  data: T[];
  meta: ApiMeta & {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface ApiFieldError {
  /** Dot-separated path of the invalid field, e.g. `password`. */
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    /** Present for VALIDATION_ERROR only. */
    details?: ApiFieldError[];
  };
}

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Authentication
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_VERIFIED: 'EMAIL_ALREADY_VERIFIED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  CSRF_REJECTED: 'CSRF_REJECTED',

  // GitHub OAuth login
  OAUTH_NOT_CONFIGURED: 'OAUTH_NOT_CONFIGURED',
  OAUTH_STATE_INVALID: 'OAUTH_STATE_INVALID',
  OAUTH_PROVIDER_ERROR: 'OAUTH_PROVIDER_ERROR',
  OAUTH_EMAIL_UNVERIFIED: 'OAUTH_EMAIL_UNVERIFIED',
  OAUTH_ACCOUNT_LINK_REQUIRED: 'OAUTH_ACCOUNT_LINK_REQUIRED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

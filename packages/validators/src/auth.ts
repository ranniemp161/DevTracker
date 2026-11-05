import { z } from 'zod';

/** Emails are compared and stored in normalized (trimmed, lower-case) form. */
export const emailSchema = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }).max(254));

export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,37}[a-z0-9])$/;

/**
 * Usernames are lower-case so `@username` mentions are case-insensitive.
 * 2–39 characters (GitHub's maximum), letters, digits, `-` and `_`,
 * starting and ending with a letter or digit.
 */
export const usernameSchema = z
  .string({ error: 'Username is required.' })
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(2, { error: 'Username must be at least 2 characters.' })
      .max(39, { error: 'Username must be at most 39 characters.' })
      .regex(USERNAME_PATTERN, {
        error: 'Use letters, numbers, - or _, starting and ending with a letter or number.',
      }),
  );

/** NIST SP 800-63B: length matters more than composition rules. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string({ error: 'Password is required.' })
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
  });

/** Opaque single-use tokens delivered by email (base64url). */
export const tokenSchema = z
  .string({ error: 'Token is required.' })
  .trim()
  .min(16, { error: 'Invalid token.' })
  .max(200, { error: 'Invalid token.' })
  .regex(/^[A-Za-z0-9_-]+$/, { error: 'Invalid token.' });

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Do not apply strength rules at login; only bound the input size.
  password: z
    .string({ error: 'Password is required.' })
    .min(1, { error: 'Password is required.' })
    .max(PASSWORD_MAX_LENGTH, { error: 'Invalid email or password.' }),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: tokenSchema });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Returns `value` only if it is a same-site relative path (`/foo?x=1`).
 * Rejects absolute URLs, protocol-relative `//host`, and backslash tricks
 * so post-login redirects cannot be turned into open redirects.
 */
export function safeRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.includes('\\')) return fallback;
  // Reject control characters (CR/LF header injection, tabs that browsers strip).
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return fallback;
  }
  return value;
}

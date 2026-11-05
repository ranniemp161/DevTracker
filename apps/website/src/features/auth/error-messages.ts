/** Messages for `?error=` codes the API appends when redirecting back from GitHub sign-in. */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  OAUTH_NOT_CONFIGURED: 'GitHub sign-in is not available right now.',
  OAUTH_STATE_INVALID:
    'Your GitHub sign-in expired or was started in another browser. Please try again.',
  OAUTH_PROVIDER_ERROR: 'GitHub sign-in was cancelled or failed. Please try again.',
  OAUTH_EMAIL_UNVERIFIED:
    'Your GitHub account needs a verified primary email address. Verify it on GitHub, then try again.',
  OAUTH_ACCOUNT_LINK_REQUIRED:
    'An account with this email already exists. Sign in with your password and verify your email, then you can use GitHub sign-in.',
};

export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return OAUTH_ERROR_MESSAGES[code] ?? 'Sign-in failed. Please try again.';
}

/** Messages for `?githubError=` codes from the installation redirect. */
const MESSAGES: Record<string, string> = {
  GITHUB_APP_NOT_CONFIGURED: 'The GitHub App is not configured on this server.',
  GITHUB_INSTALL_STATE_INVALID:
    'The GitHub installation session expired or did not start here. Please start the GitHub connection again.',
  GITHUB_INSTALL_NOT_AUTHORIZED:
    'GitHub did not confirm that you can manage that installation, so it was not connected.',
  GITHUB_API_ERROR: 'GitHub could not be reached. Please try again.',
  FORBIDDEN: 'Only workspace admins can manage GitHub connections.',
  NOT_FOUND: 'This workspace does not exist or you are not a member.',
};

export function githubErrorMessage(code: string): string {
  return MESSAGES[code] ?? 'The GitHub installation did not complete. Please try again.';
}

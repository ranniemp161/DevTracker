import type { MailMessage } from './mailer';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout(title: string, paragraphs: string[], action: { label: string; url: string }) {
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="color:#666;font-size:13px">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>
</body></html>`;
  const text = `${title}\n\n${paragraphs.join('\n\n')}\n\n${action.label}: ${action.url}\n`;
  return { html, text };
}

/** Links carry the token in the URL fragment so it never reaches server logs or Referer headers. */
export function verificationEmail(
  to: string,
  username: string,
  webOrigin: string,
  token: string,
): MailMessage {
  const url = `${webOrigin}/verify-email#token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Verify your DevTrack email',
    ...layout(
      'Verify your email',
      [
        `Hi ${username},`,
        'Confirm your email address to start using DevTrack. This link expires in 24 hours.',
      ],
      { label: 'Verify email', url },
    ),
  };
}

export function passwordResetEmail(
  to: string,
  username: string,
  webOrigin: string,
  token: string,
): MailMessage {
  const url = `${webOrigin}/reset-password#token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your DevTrack password',
    ...layout(
      'Reset your password',
      [
        `Hi ${username},`,
        'Someone asked to reset the password for your DevTrack account. This link expires in 1 hour and can be used once.',
        'If you did not ask for this, you can ignore this email.',
      ],
      { label: 'Reset password', url },
    ),
  };
}

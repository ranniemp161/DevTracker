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

export function invitationEmail(params: {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: 'ADMIN' | 'MEMBER';
  webOrigin: string;
  token: string;
}): MailMessage {
  const url = `${params.webOrigin}/invitations/accept#token=${encodeURIComponent(params.token)}`;
  const roleLabel = params.role === 'ADMIN' ? 'an admin' : 'a member';
  return {
    to: params.to,
    subject: `${params.inviterName} invited you to ${params.workspaceName} on DevTrack`,
    ...layout(
      `Join ${params.workspaceName} on DevTrack`,
      [
        `${params.inviterName} invited you to join ${params.workspaceName} as ${roleLabel}.`,
        `Sign in or create an account with ${params.to} to accept. This invitation expires in 7 days and can be used once.`,
      ],
      { label: 'Accept invitation', url },
    ),
  };
}

/**
 * Decision record 0028 §2: a status email to someone outside the team. Only what they sent us
 * and what we chose to tell them: never task keys, comments, people or other tasks.
 */
export function clientUpdateEmail(input: {
  to: string;
  projectName: string;
  requestTitle: string;
  kind: 'accepted' | 'declined' | 'done' | 'delivered';
  milestoneName?: string | null;
  reason?: string | null;
  releaseTags?: string[];
  stopUrl: string;
}): MailMessage {
  const what = `“${input.requestTitle}”`;
  const content = {
    accepted: {
      subject: `${input.projectName}: we're working on your request`,
      title: "We're working on your request",
      paragraphs: [
        `The ${input.projectName} team accepted ${what}.`,
        ...(input.milestoneName ? [`It's planned for ${input.milestoneName}.`] : []),
      ],
    },
    declined: {
      subject: `${input.projectName}: an update on your request`,
      title: "We won't be doing this one",
      paragraphs: [
        `The ${input.projectName} team decided not to take on ${what}.`,
        ...(input.reason ? [`Their reason: ${input.reason}`] : []),
      ],
    },
    done: {
      subject: `${input.projectName}: your request is done`,
      title: 'Your request is done',
      paragraphs: [`The ${input.projectName} team finished ${what}.`],
    },
    delivered: {
      subject: `${input.projectName}: your request has been delivered`,
      title: 'Your request has been delivered',
      paragraphs: [
        `${what} is part of ${input.milestoneName ?? 'a delivery'}, which the ${input.projectName} team has delivered.`,
        ...(input.releaseTags?.length ? [`Release: ${input.releaseTags.join(', ')}`] : []),
      ],
    },
  }[input.kind];
  const footer = 'You get these emails because you left your address on the request form.';
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<h1 style="font-size:20px">${escapeHtml(content.title)}</h1>
${content.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
<p style="color:#666;font-size:13px">${escapeHtml(footer)} <a href="${escapeHtml(input.stopUrl)}">Stop emails about this request</a></p>
</body></html>`;
  const text = `${content.title}\n\n${content.paragraphs.join('\n\n')}\n\n${footer}\nStop emails about this request: ${input.stopUrl}\n`;
  return { to: input.to, subject: content.subject, html, text };
}

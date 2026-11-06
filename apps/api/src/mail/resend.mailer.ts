import type { Mailer, MailMessage } from './mailer';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/**
 * Production transport: Resend's HTTP API (decision record 0008, open decision #1).
 * Throws on failure without including the message (it carries one-time links); callers log
 * the error and the user can request the email again.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DevTrack',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw new Error(`Resend request failed: ${err instanceof Error ? err.name : 'error'}`);
    });
    if (!res.ok) {
      // Resend error bodies describe the problem (e.g. unverified domain) and contain no secrets.
      const body = (await res.json().catch(() => null)) as {
        name?: string;
        message?: string;
      } | null;
      throw new Error(
        `Resend rejected the email (${res.status} ${body?.name ?? ''}): ${body?.message ?? ''}`.trim(),
      );
    }
  }
}

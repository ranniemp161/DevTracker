'use client';

import type { PublicSignoff } from '@devtrack/types';
import { approveSignoffSchema } from '@devtrack/validators';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CheckIcon, DevtrackMark, TagIcon } from '@/components/icons';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate } from '../projects/labels';
import { Turnstile, TURNSTILE_SITE_KEY } from './turnstile';

/**
 * The client's review page at /s/<token> (decision record 0028 §3–§4). No sign-in. It shows
 * only what was promised (criteria and releases) and lets the client approve. Approving tells
 * the team; it never changes anything else.
 */
export function ClientSignoff() {
  const { token } = useParams<{ token: string }>();
  const page = useApiQuery<PublicSignoff>(`/public/signoff/${token}`);
  const [values, setValues] = useState({ name: '', note: '', website: '' });
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  async function approve(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = approveSignoffSchema.safeParse({
      ...values,
      turnstileToken: captcha ?? undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }
    if (TURNSTILE_SITE_KEY && !captcha) {
      setError('Please complete the check above the button.');
      return;
    }
    setSending(true);
    try {
      await api(`/public/signoff/${token}/approve`, { body: parsed.data });
      setApproved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setCaptcha(null);
      setCaptchaReset((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  const m = page.data?.milestone;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-6 bg-bg px-4 py-10 sm:justify-center">
      <div className="w-full max-w-xl rounded-panel border border-line bg-surface p-5 shadow-card sm:p-8">
        {page.error ? (
          <div className="space-y-2 text-center">
            <h1 className="text-title font-semibold tracking-tight text-fg">Link not active</h1>
            <p className="text-sm text-fg-muted">
              This review link is no longer active. Ask the team for a new one.
            </p>
          </div>
        ) : !page.data || !m ? (
          <p className="text-sm text-fg-subtle">Loading…</p>
        ) : (
          <div className="space-y-6">
            <header className="space-y-1">
              <p className="text-label text-fg-muted">{page.data.projectName}</p>
              <h1 className="text-title font-semibold tracking-tight text-fg">Review: {m.name}</h1>
              {m.description ? <p className="text-sm text-fg-muted">{m.description}</p> : null}
              {m.dueDate ? (
                <p className="text-xs text-fg-muted">Due {formatDate(m.dueDate)}</p>
              ) : null}
            </header>

            <section aria-label="What was agreed" className="space-y-2">
              <h2 className="text-md font-semibold text-fg">What was agreed</h2>
              {m.criteria.length === 0 ? (
                <p className="text-sm text-fg-muted">No acceptance criteria were written down.</p>
              ) : (
                <ul className="space-y-1.5">
                  {m.criteria.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-fg">
                      <span
                        className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${c.done ? 'border-status-done bg-status-done-bg text-status-done-fg' : 'border-line-control'}`}
                      >
                        {c.done ? <CheckIcon size={10} /> : null}
                      </span>
                      <span>
                        {c.text}
                        <span className="sr-only">{c.done ? ' (met)' : ' (not met yet)'}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {m.releases.length > 0 ? (
              <section aria-label="Releases" className="space-y-2">
                <h2 className="text-md font-semibold text-fg">Releases</h2>
                <ul className="flex flex-wrap gap-2">
                  {m.releases.map((r) => (
                    <li key={r.url}>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg hover:underline"
                      >
                        <TagIcon size={14} />
                        {r.tag}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {approved ? (
              <Alert tone="info">
                Thank you. The team has been told you approved this delivery.
              </Alert>
            ) : (
              <form onSubmit={approve} noValidate className="space-y-4 border-t border-line pt-5">
                {m.approvedAt ? (
                  <p className="text-xs text-fg-muted">
                    Already approved on {formatDate(m.approvedAt)}. Approving again updates it.
                  </p>
                ) : null}
                <Field
                  label="Your name (optional)"
                  name="name"
                  value={values.name}
                  maxLength={80}
                  autoComplete="name"
                  onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                />
                <label className="block space-y-1.5 text-sm">
                  <span className="block text-label font-medium text-fg">Note (optional)</span>
                  <textarea
                    name="note"
                    value={values.note}
                    maxLength={500}
                    rows={3}
                    onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
                    className="w-full rounded-control border border-line-control bg-surface px-3 py-2 text-sm text-fg focus-visible:border-primary"
                  />
                </label>
                {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
                <div aria-hidden="true" className="hidden">
                  <label>
                    Website
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={values.website}
                      onChange={(e) => setValues((v) => ({ ...v, website: e.target.value }))}
                    />
                  </label>
                </div>
                <Turnstile onToken={setCaptcha} resetKey={captchaReset} />
                {error ? <Alert>{error}</Alert> : null}
                <Button
                  type="submit"
                  variant="primary"
                  size="xl"
                  loading={sending}
                  className="w-full"
                >
                  {sending ? 'Sending…' : 'Approve this delivery'}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <DevtrackMark size={14} /> DevTrack
      </p>
    </main>
  );
}

'use client';

import type { PublicIntakeInfo } from '@devtrack/types';
import { submitRequestSchema } from '@devtrack/validators';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CheckIcon, DevtrackMark } from '@/components/icons';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { Turnstile, TURNSTILE_SITE_KEY } from './turnstile';

type Kind = 'bug' | 'request';
const EMPTY = { kind: 'bug' as Kind, title: '', description: '', name: '', email: '', website: '' };

/** Public request form at /r/<token> (decision record 0016). No sign-in. */
export function PublicRequestForm() {
  const { token } = useParams<{ token: string }>();
  const info = useApiQuery<PublicIntakeInfo>(`/public/requests/${token}`);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const set = (field: keyof typeof EMPTY) => (value: string) =>
    setValues((v) => ({ ...v, [field]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = submitRequestSchema.safeParse({
      ...values,
      turnstileToken: captcha ?? undefined,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    if (TURNSTILE_SITE_KEY && !captcha) {
      setFormError('Please complete the check below the form.');
      return;
    }
    setSending(true);
    try {
      await api(`/public/requests/${token}`, { body: parsed.data });
      setSent(true);
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.status === 429
            ? 'Too many submissions from your network. Please try again later.'
            : (err.details[0]?.message ?? err.message)
          : 'Could not send. Check your connection and try again.',
      );
      setCaptcha(null);
      setCaptchaReset((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-6 bg-bg px-4 py-10 sm:justify-center">
      <div className="w-full max-w-lg rounded-panel border border-line bg-surface p-6 shadow-card sm:p-8">
        {info.error ? (
          <div className="space-y-2 text-center">
            <h1 className="text-title font-semibold tracking-tight text-fg">Form not available</h1>
            <p className="text-sm text-fg-muted">
              This link is not active. Ask the team for a new one.
            </p>
          </div>
        ) : !info.data ? (
          <p className="text-sm text-fg-subtle">Loading…</p>
        ) : sent ? (
          <div className="space-y-3 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
              <CheckIcon size={22} />
            </span>
            <h1 className="text-title font-semibold tracking-tight text-fg">Thanks, we got it</h1>
            <p className="text-sm text-fg-muted">
              The {info.data.projectName} team will review your{' '}
              {values.kind === 'bug' ? 'report' : 'request'}.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setValues(EMPTY);
                setSent(false);
                setCaptcha(null);
                setCaptchaReset((n) => n + 1);
              }}
            >
              Send another
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <div>
              <p className="text-label text-fg-muted">{info.data.projectName}</p>
              <h1 className="mt-1 text-title font-semibold tracking-tight text-fg">
                Report a bug or request a change
              </h1>
            </div>
            {formError ? <Alert>{formError}</Alert> : null}

            <fieldset>
              <legend className="mb-1.5 text-label font-medium text-fg">What is it?</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['bug', 'request'] as const).map((kind) => (
                  <label
                    key={kind}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm font-medium transition-colors ${
                      values.kind === kind
                        ? 'border-primary bg-primary-soft text-primary-soft-fg'
                        : 'border-line-control text-fg-secondary hover:bg-surface-sunken'
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={kind}
                      checked={values.kind === kind}
                      onChange={() => set('kind')(kind)}
                    />
                    {kind === 'bug' ? 'Something is broken' : 'A new idea or change'}
                  </label>
                ))}
              </div>
            </fieldset>

            <Field
              label="Title"
              name="title"
              value={values.title}
              maxLength={200}
              placeholder={
                values.kind === 'bug' ? 'The checkout button does nothing' : 'Add a dark mode'
              }
              onChange={(e) => set('title')(e.target.value)}
              error={errors.title}
            />

            <div className="space-y-1.5">
              <label htmlFor="field-description" className="block text-label font-medium text-fg">
                Details <span className="font-normal text-fg-muted">(optional)</span>
              </label>
              <textarea
                id="field-description"
                rows={5}
                maxLength={5000}
                value={values.description}
                onChange={(e) => set('description')(e.target.value)}
                aria-invalid={errors.description ? true : undefined}
                placeholder={
                  values.kind === 'bug'
                    ? 'What did you do, what did you expect, and what happened instead?'
                    : 'What would you like, and why?'
                }
                className="block w-full rounded-control border border-line-control bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-subtle focus-visible:border-primary sm:text-sm"
              />
              {errors.description ? (
                <p className="text-xs text-danger">{errors.description}</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Your name (optional)"
                name="name"
                autoComplete="name"
                value={values.name}
                maxLength={80}
                onChange={(e) => set('name')(e.target.value)}
                error={errors.name}
              />
              <Field
                label="Email (optional)"
                name="email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={(e) => set('email')(e.target.value)}
                error={errors.email}
                hint="Only if you'd like a reply."
              />
            </div>

            {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
            <div aria-hidden="true" className="hidden">
              <label>
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.website}
                  onChange={(e) => set('website')(e.target.value)}
                />
              </label>
            </div>

            <Turnstile onToken={setCaptcha} resetKey={captchaReset} />

            <Button type="submit" variant="primary" size="xl" loading={sending} className="w-full">
              {sending ? 'Sending…' : 'Send'}
            </Button>
            <p className="text-center text-xs text-fg-muted">
              Your name and email are only shared with the {info.data.projectName} team and are
              deleted 90 days after your report is closed.
            </p>
          </form>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        <DevtrackMark size={14} /> DevTrack
      </p>
    </main>
  );
}

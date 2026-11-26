'use client';

import type { PublicIntakeInfo, RequestReceipt, RequestUpload } from '@devtrack/types';
import { submitRequestSchema } from '@devtrack/validators';
import { useParams } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AlertIcon, CheckIcon, DevtrackMark, PaperclipIcon, StarIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Alert, Button, Field, SegmentedControl } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { AttachmentPicker } from './attachment-picker';
import type { PickedFile } from './request-files';
import {
  detailsForKind,
  detailsToSend,
  REQUEST_TEMPLATES,
  type RequestKind,
} from './request-template';
import { Turnstile, TURNSTILE_SITE_KEY } from './turnstile';
import { uploadRequestFile } from './upload-request-files';

const TITLE_MAX = 200;
const DETAILS_MAX = 5000;
const EMPTY = {
  kind: 'bug' as RequestKind,
  title: '',
  description: REQUEST_TEMPLATES.bug,
  name: '',
  email: '',
  website: '',
};

const KINDS: { kind: RequestKind; label: string; hint: string; icon: ReactNode }[] = [
  {
    kind: 'bug',
    label: 'Something is broken',
    hint: 'An error, a crash, or something not working as it should',
    icon: <AlertIcon size={18} />,
  },
  {
    kind: 'request',
    label: 'A new idea or change',
    hint: 'A feature you would like, or a change to how something works',
    icon: <StarIcon size={18} />,
  },
];

/** One file's fate after sending. */
type FileState =
  { status: 'uploading'; progress: number } | { status: 'done' } | { status: 'failed' };
interface Sent {
  kind: RequestKind;
  title: string;
  files: { picked: PickedFile; upload: RequestUpload | null; state: FileState }[];
}

/**
 * Public request form at /r/<token> (decision records 0016 and 0022). No sign-in. Senders can
 * attach screenshots and Markdown files; they upload after the request itself is accepted, so
 * a failed upload never loses the request.
 */
export function PublicRequestForm() {
  const { token } = useParams<{ token: string }>();
  const info = useApiQuery<PublicIntakeInfo>(`/public/requests/${token}`);
  const [values, setValues] = useState(EMPTY);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const set = (field: keyof typeof EMPTY) => (value: string) =>
    setValues((v) => ({ ...v, [field]: value }));

  function chooseKind(kind: RequestKind) {
    setValues((v) => ({ ...v, kind, description: detailsForKind(v.description, kind) }));
  }

  function setFileState(key: string, state: FileState) {
    setSent((s) =>
      s ? { ...s, files: s.files.map((f) => (f.picked.key === key ? { ...f, state } : f)) } : s,
    );
  }

  async function upload(upload: RequestUpload, picked: PickedFile) {
    setFileState(picked.key, { status: 'uploading', progress: 0 });
    try {
      await uploadRequestFile(token, upload, picked.file, (progress) =>
        setFileState(picked.key, { status: 'uploading', progress }),
      );
      setFileState(picked.key, { status: 'done' });
    } catch {
      setFileState(picked.key, { status: 'failed' });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = submitRequestSchema.safeParse({
      ...values,
      description: detailsToSend(values.description),
      turnstileToken: captcha ?? undefined,
      attachments: files.map((f) => ({
        name: f.file.name,
        contentType: f.contentType,
        size: f.file.size,
      })),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    if (TURNSTILE_SITE_KEY && !captcha) {
      setFormError('Please complete the check above the Send button.');
      return;
    }
    setSending(true);
    try {
      const receipt = await api<RequestReceipt>(`/public/requests/${token}`, {
        body: parsed.data,
      });
      const entries = files.map((picked, i) => ({
        picked,
        upload: receipt.uploads[i] ?? null,
        state: { status: 'uploading', progress: 0 } as FileState,
      }));
      setSent({ kind: values.kind, title: parsed.data.title, files: entries });
      await Promise.all(
        entries.map((entry) =>
          entry.upload
            ? upload(entry.upload, entry.picked)
            : setFileState(entry.picked.key, { status: 'failed' }),
        ),
      );
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.status === 429
            ? 'Too many submissions or files from your network. Please try again later.'
            : (err.details[0]?.message ?? err.message)
          : 'Could not send. Check your connection and try again.',
      );
      setCaptcha(null);
      setCaptchaReset((n) => n + 1);
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setValues(EMPTY);
    setFiles([]);
    setTab('write');
    setSent(null);
    setCaptcha(null);
    setCaptchaReset((n) => n + 1);
  }

  const details = values.description;
  const uploadsEnabled = info.data?.uploadsEnabled ?? false;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-start gap-6 bg-bg px-4 py-10 sm:justify-center">
      <div className="w-full max-w-xl rounded-panel border border-line bg-surface p-5 shadow-card sm:p-8">
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
          <SentSummary
            sent={sent}
            projectName={info.data.projectName}
            onRetry={(key) => {
              const entry = sent.files.find((f) => f.picked.key === key);
              if (entry?.upload) void upload(entry.upload, entry.picked);
            }}
            onAnother={reset}
          />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6">
            <header className="space-y-1">
              <p className="text-label text-fg-muted">{info.data.projectName}</p>
              <h1 className="text-title font-semibold tracking-tight text-fg">
                Report a bug or request a change
              </h1>
              <p className="text-sm text-fg-muted">
                Your message goes straight to the {info.data.projectName} team.
              </p>
            </header>
            {formError ? <Alert>{formError}</Alert> : null}

            <fieldset>
              <legend className="mb-2 text-label font-medium text-fg">What is it?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {KINDS.map(({ kind, label, hint, icon }) => {
                  const selected = values.kind === kind;
                  return (
                    <label
                      key={kind}
                      className={`flex cursor-pointer gap-3 rounded-card border p-3.5 transition-colors has-focus-visible:border-primary ${
                        selected
                          ? 'border-primary bg-primary-soft'
                          : 'border-line-control hover:bg-surface-sunken'
                      }`}
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={kind}
                        checked={selected}
                        onChange={() => chooseKind(kind)}
                        className="sr-only"
                      />
                      <span
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
                          selected ? 'bg-surface text-primary' : 'bg-surface-muted text-fg-muted'
                        }`}
                      >
                        {icon}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block text-sm font-medium ${selected ? 'text-primary-soft-fg' : 'text-fg'}`}
                        >
                          {label}
                        </span>
                        <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-1">
              <Field
                label="Title"
                name="title"
                value={values.title}
                maxLength={TITLE_MAX}
                placeholder={
                  values.kind === 'bug'
                    ? 'The checkout button does nothing'
                    : 'Let us export reports as PDF'
                }
                onChange={(e) => set('title')(e.target.value)}
                error={errors.title}
              />
              <Counter value={values.title.length} max={TITLE_MAX} from={160} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="field-description" className="text-label font-medium text-fg">
                  Details <span className="font-normal text-fg-muted">(optional)</span>
                </label>
                <SegmentedControl
                  label="Details view"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'write', label: 'Write' },
                    { value: 'preview', label: 'Preview' },
                  ]}
                />
              </div>
              {tab === 'write' ? (
                <textarea
                  id="field-description"
                  rows={8}
                  maxLength={DETAILS_MAX}
                  value={details}
                  onChange={(e) => set('description')(e.target.value)}
                  aria-invalid={errors.description ? true : undefined}
                  aria-describedby="field-description-hint"
                  className="block min-h-40 w-full rounded-control border border-line-control bg-surface px-3 py-2 text-base leading-relaxed text-fg placeholder:text-fg-subtle focus-visible:border-primary sm:text-sm"
                />
              ) : (
                <div className="min-h-40 rounded-control border border-line bg-surface-sunken px-3 py-2">
                  {detailsToSend(details).trim() ? (
                    <Markdown imagesAsLinks>{details}</Markdown>
                  ) : (
                    <p className="text-sm text-fg-subtle">Nothing to preview yet.</p>
                  )}
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <p id="field-description-hint" className="text-xs text-fg-muted">
                  Markdown works: **bold**, - lists, `code`. Fill in what you can.
                </p>
                <Counter value={details.length} max={DETAILS_MAX} from={4000} />
              </div>
              {errors.description ? (
                <p className="text-xs text-danger">{errors.description}</p>
              ) : null}
            </div>

            {uploadsEnabled ? (
              <AttachmentPicker files={files} onChange={setFiles} disabled={sending} />
            ) : null}

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
              {sending
                ? 'Sending…'
                : files.length
                  ? `Send with ${files.length} ${files.length === 1 ? 'file' : 'files'}`
                  : 'Send'}
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

/** Shows "n / max" once the text gets close to its limit. */
function Counter({ value, max, from }: { value: number; max: number; from: number }) {
  if (value < from) return null;
  return (
    <p
      className={`shrink-0 text-right text-xs tabular-nums ${value >= max ? 'text-danger' : 'text-fg-muted'}`}
    >
      {value.toLocaleString()} / {max.toLocaleString()}
    </p>
  );
}

/** After sending: what was sent, each file's upload, a retry for failed ones, and Send another. */
function SentSummary({
  sent,
  projectName,
  onRetry,
  onAnother,
}: {
  sent: Sent;
  projectName: string;
  onRetry: (key: string) => void;
  onAnother: () => void;
}) {
  const uploading = sent.files.some((f) => f.state.status === 'uploading');
  const failed = sent.files.filter((f) => f.state.status === 'failed').length;
  return (
    <div className="space-y-5">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
          <CheckIcon size={22} />
        </span>
        <h1 className="text-title font-semibold tracking-tight text-fg">Thanks, we got it</h1>
        <p className="text-sm text-fg-muted">
          The {projectName} team will review your {sent.kind === 'bug' ? 'report' : 'request'}.
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface-sunken p-4">
        <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
          {sent.kind === 'bug' ? 'Bug report' : 'Request'}
        </p>
        <p className="mt-1 text-sm font-medium text-fg">{sent.title}</p>
        {sent.files.length > 0 ? (
          <ul className="mt-3 space-y-2 border-t border-line-subtle pt-3">
            {sent.files.map(({ picked, upload, state }) => (
              <li key={picked.key} className="flex items-center gap-2.5 text-sm">
                <PaperclipIcon size={14} className="shrink-0 text-fg-subtle" />
                <span className="min-w-0 flex-1 truncate text-fg-secondary">
                  {picked.file.name}
                </span>
                {state.status === 'uploading' ? (
                  <span className="flex items-center gap-2">
                    <span
                      role="progressbar"
                      aria-label={`Uploading ${picked.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(state.progress * 100)}
                      className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted"
                    >
                      <span
                        className="block h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.round(state.progress * 100)}%` }}
                      />
                    </span>
                  </span>
                ) : state.status === 'done' ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-status-done-fg">
                    <CheckIcon size={14} /> Attached
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs text-danger">
                    Not attached
                    {upload ? (
                      <button
                        type="button"
                        onClick={() => onRetry(picked.key)}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        Retry
                      </button>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p role="status" className="text-center text-xs text-fg-muted">
        {uploading
          ? 'Uploading your files… keep this page open.'
          : failed
            ? `${failed} ${failed === 1 ? 'file was' : 'files were'} not attached. Retry now, or send them in a new request.`
            : ''}
      </p>
      <div className="text-center">
        <Button variant="secondary" onClick={onAnother} disabled={uploading}>
          Send another
        </Button>
      </div>
    </div>
  );
}

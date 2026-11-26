'use client';

import type { TaskAttachment } from '@devtrack/types';
import { createTaskAttachmentSchema, TASK_MEDIA_TYPES } from '@devtrack/validators';
import { useId, useState, type ChangeEvent } from 'react';
import { PaperclipIcon, SpinnerIcon } from '@/components/icons';
import { Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { AttachmentGrid } from './attachment-grid';
import { useProject } from './project-context';

export function TaskAttachments({ taskId }: { taskId: string }) {
  const path = `/tasks/${taskId}/attachments`;
  const query = useApiQuery<{ attachments: TaskAttachment[]; uploadsEnabled: boolean }>(path);
  const inputId = useId();
  const { readOnly } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const picker = event.currentTarget;
    const file = picker.files?.[0];
    if (!file) return;
    const input = createTaskAttachmentSchema.safeParse({
      name: file.name,
      // Browsers can report Markdown as plain text or omit its MIME type.
      contentType: /\.(md|markdown)$/i.test(file.name) ? 'text/markdown' : file.type,
      size: file.size,
    });
    if (!input.success) {
      picker.value = '';
      setError('Choose a PNG, JPEG, GIF, WebP, MP4, WebM, MOV or Markdown file up to 50 MiB.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { id, url, headers } = await api<{
        id: string;
        url: string;
        headers: Record<string, string>;
      }>(path, { body: input.data });
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: file,
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) throw new Error('Upload failed.');
      await api(`${path}/${id}/complete`, { method: 'POST' });
      query.reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Could not upload the file. Try again.',
      );
    } finally {
      picker.value = '';
      setBusy(false);
    }
  }

  const attachments = query.data?.attachments;

  return (
    <section aria-labelledby={`${inputId}-heading`} className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${inputId}-heading`} className="text-md font-semibold">
          Attachments
          {attachments?.length ? (
            <span className="ml-1.5 text-sm font-normal text-fg-muted">{attachments.length}</span>
          ) : null}
        </h2>
        {query.data?.uploadsEnabled && !readOnly ? (
          <div className="flex items-center">
            {/* The real file input stays focusable; the label is its visible button. */}
            <input
              id={inputId}
              type="file"
              accept={[...TASK_MEDIA_TYPES, '.md', '.markdown'].join(',')}
              aria-describedby={`${inputId}-hint`}
              onChange={upload}
              disabled={busy}
              className="peer sr-only"
            />
            <label
              htmlFor={inputId}
              className="inline-flex h-7.5 cursor-pointer items-center gap-1.5 rounded-control border border-line-control bg-surface px-2.5 text-label font-medium text-fg transition-colors hover:bg-surface-sunken peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-default peer-disabled:opacity-60 pointer-coarse:h-11"
            >
              {busy ? <SpinnerIcon size={14} /> : <PaperclipIcon size={14} />}
              {busy ? 'Uploading…' : 'Attach file'}
            </label>
          </div>
        ) : null}
      </div>
      <p id={`${inputId}-hint`} className="sr-only">
        PNG, JPEG, GIF, WebP, MP4, WebM, MOV or Markdown (.md, .markdown), up to 50 MiB.
      </p>
      <p role="status" className="sr-only">
        {busy ? 'Uploading attachment…' : ''}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {query.error ? (
        <p className="text-sm text-fg-muted">
          Could not load attachments.{' '}
          <button type="button" className="underline" onClick={query.reload}>
            Retry
          </button>
        </p>
      ) : !attachments ? (
        <Skeleton className="h-24" />
      ) : attachments.length ? (
        <AttachmentGrid taskId={taskId} attachments={attachments} />
      ) : (
        <p className="text-sm text-fg-subtle">No attachments yet.</p>
      )}
    </section>
  );
}

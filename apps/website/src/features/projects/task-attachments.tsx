'use client';

import type { TaskAttachment } from '@devtrack/types';
import { createTaskAttachmentSchema, TASK_MEDIA_TYPES } from '@devtrack/validators';
import { useId, useState, type FormEvent } from 'react';
import { Button, PanelSection, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';

export function TaskAttachments({ taskId }: { taskId: string }) {
  const path = `/tasks/${taskId}/attachments`;
  const query = useApiQuery<{ attachments: TaskAttachment[]; uploadsEnabled: boolean }>(path);
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('file');
    if (!(file instanceof File)) return;
    const input = createTaskAttachmentSchema.safeParse({
      name: file.name,
      contentType: file.type,
      size: file.size,
    });
    if (!input.success) {
      setError('Choose a supported image or video between 1 byte and 50 MiB.');
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
      form.reset();
      query.reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Could not upload the file. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelSection title="Attachments">
      {query.data?.uploadsEnabled ? (
        <form onSubmit={upload} className="space-y-2" aria-label="Upload attachment">
          <label htmlFor={inputId} className="block text-sm font-medium text-fg">
            Choose a media file
          </label>
          <p id={`${inputId}-hint`} className="text-xs text-fg-muted">
            PNG, JPEG, GIF, WebP, MP4, WebM, or MOV. Up to 50 MiB.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              name="file"
              type="file"
              accept={TASK_MEDIA_TYPES.join(',')}
              aria-describedby={`${inputId}-hint`}
              className="max-w-full text-sm"
              required
              disabled={busy}
            />
            <Button type="submit" size="sm" disabled={busy}>
              Upload
            </Button>
          </div>
          {busy ? (
            <p role="status" className="text-sm text-fg-muted">
              Uploading attachment…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {query.error ? (
        <p className="text-sm text-fg-muted">
          Could not load attachments.{' '}
          <button type="button" className="underline" onClick={query.reload}>
            Retry
          </button>
        </p>
      ) : !query.data ? (
        <Skeleton className="h-10" />
      ) : query.data.attachments.length ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {query.data.attachments.map((attachment) => (
              <li key={attachment.id} className="min-w-0 rounded-control border border-line p-2">
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm text-primary underline [overflow-wrap:anywhere]"
                >
                  {attachment.contentType.startsWith('image/') ? (
                    // The signed private URL goes directly to the media origin.
                    <img
                      src={attachment.url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="mb-2 h-28 w-full rounded-control bg-surface-muted object-contain"
                    />
                  ) : null}
                  {attachment.name}
                </a>
              </li>
            ))}
          </ul>
          <button type="button" className="text-xs text-fg-muted underline" onClick={query.reload}>
            Refresh attachment links
          </button>
        </>
      ) : (
        <p className="text-sm text-fg-muted">No attachments yet.</p>
      )}
    </PanelSection>
  );
}

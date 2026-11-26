'use client';

import type { TaskAttachment } from '@devtrack/types';
import { useState } from 'react';
import { PaperclipIcon, XIcon } from '@/components/icons';
import { Markdown } from '@/components/markdown';
import { Button, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';

const isMarkdown = (a: TaskAttachment) => a.contentType === 'text/markdown';

/**
 * A task's completed attachments: image thumbnails, file tiles, and Markdown files that open
 * as a rendered preview below the grid (decision record 0022 §5). Used on the task page and
 * in Triage.
 */
export function AttachmentGrid({
  taskId,
  attachments,
  compact = false,
}: {
  taskId: string;
  attachments: TaskAttachment[];
  compact?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = attachments.find((a) => a.id === openId && isMarkdown(a)) ?? null;
  const tile = `group block w-full overflow-hidden rounded-card border bg-surface text-left transition-colors hover:border-line-control`;

  return (
    <div className="space-y-3">
      <ul className={compact ? 'flex flex-wrap gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3'}>
        {attachments.map((attachment) => {
          const media = attachment.contentType.startsWith('image/') ? (
            // The signed private URL goes directly to the media origin.
            <img
              src={attachment.url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="aspect-video w-full bg-surface-muted object-cover"
            />
          ) : isMarkdown(attachment) ? (
            <span className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-surface-muted text-fg-muted">
              <span className="font-mono text-xs font-semibold">MD</span>
              <span className="text-xs">Markdown</span>
            </span>
          ) : (
            <span className="flex aspect-video w-full items-center justify-center bg-surface-muted text-fg-muted">
              <PaperclipIcon size={20} />
            </span>
          );
          const name = (
            <span className="block truncate px-2.5 py-2 text-label text-fg-secondary group-hover:text-fg">
              {attachment.name}
            </span>
          );
          return (
            <li key={attachment.id} className={compact ? 'w-36 min-w-0' : 'min-w-0'}>
              {isMarkdown(attachment) ? (
                <button
                  type="button"
                  aria-expanded={openId === attachment.id}
                  onClick={() => setOpenId((id) => (id === attachment.id ? null : attachment.id))}
                  className={`${tile} ${openId === attachment.id ? 'border-primary' : 'border-line'}`}
                >
                  {media}
                  {name}
                </button>
              ) : (
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`${tile} border-line`}
                >
                  {media}
                  {name}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {open ? (
        <MarkdownPreview taskId={taskId} attachment={open} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}

function MarkdownPreview({
  taskId,
  attachment,
  onClose,
}: {
  taskId: string;
  attachment: TaskAttachment;
  onClose: () => void;
}) {
  const query = useApiQuery<{ content: string }>(
    `/tasks/${taskId}/attachments/${attachment.id}/content`,
  );
  return (
    <section
      aria-label={`Preview of ${attachment.name}`}
      className="rounded-card border border-line bg-surface"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line-subtle px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs text-fg-muted">{attachment.name}</span>
        <span className="flex shrink-0 items-center gap-1">
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-control px-2 py-1 text-label font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
          >
            Download
          </a>
          <Button size="sm" variant="ghost" aria-label="Close preview" onClick={onClose}>
            <XIcon size={14} />
          </Button>
        </span>
      </header>
      <div className="max-h-120 overflow-y-auto px-4 py-3">
        {query.error ? (
          <p className="text-sm text-fg-muted">
            Could not load this file.{' '}
            <button type="button" className="underline" onClick={query.reload}>
              Retry
            </button>
          </p>
        ) : !query.data ? (
          <Skeleton className="h-24" />
        ) : query.data.content.trim() ? (
          // Written outside the team (request form) or by members: images stay links (0022 §5).
          <Markdown imagesAsLinks>{query.data.content}</Markdown>
        ) : (
          <p className="text-sm text-fg-subtle">This file is empty.</p>
        )}
      </div>
    </section>
  );
}

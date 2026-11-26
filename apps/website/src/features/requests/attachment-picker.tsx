'use client';

import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { PaperclipIcon, XIcon } from '@/components/icons';
import { addFiles, formatBytes, REQUEST_FILE_ACCEPT, type PickedFile } from './request-files';

/**
 * Screenshots and Markdown files for the public request form (decision record 0022): drop
 * them, choose them, or paste a screenshot anywhere on the page. Images show as thumbnails,
 * Markdown files as chips; each can be removed before sending.
 */
export function AttachmentPicker({
  files,
  onChange,
  disabled,
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const latest = useRef({ files, onChange, disabled });
  useEffect(() => {
    latest.current = { files, onChange, disabled };
  });

  function add(incoming: File[], pasted = false) {
    const next = addFiles(latest.current.files, incoming, { pasted });
    setErrors(next.errors);
    latest.current.onChange(next.files);
  }

  // A screenshot pasted anywhere on the page (Ctrl+V / ⌘V) is attached, unless the person is
  // pasting text into a field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (latest.current.disabled) return;
      const pasted = [...(e.clipboardData?.files ?? [])];
      if (pasted.length === 0) return;
      e.preventDefault();
      add(pasted, true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (!disabled) add([...e.dataTransfer.files]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label font-medium text-fg">
          Attachments <span className="font-normal text-fg-muted">(optional)</span>
        </span>
        <span className="text-xs text-fg-subtle tabular-nums">{files.length} / 5</span>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-card border border-dashed px-4 py-5 text-center transition-colors ${
          over ? 'border-primary bg-primary-soft' : 'border-line-control bg-surface-sunken'
        }`}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-surface text-fg-muted">
          <PaperclipIcon size={18} />
        </span>
        <p className="text-sm text-fg-secondary">
          Drop screenshots or <code className="font-mono text-xs">.md</code> files here,{' '}
          <span className="hidden sm:inline">paste a screenshot, </span>or{' '}
          <button
            type="button"
            disabled={disabled || files.length >= 5}
            onClick={() => input.current?.click()}
            className="font-medium text-primary underline-offset-2 hover:underline disabled:text-fg-subtle disabled:no-underline"
          >
            choose files
          </button>
        </p>
        <p id={hintId} className="text-xs text-fg-subtle">
          PNG, JPEG, GIF or WebP up to 10 MB · Markdown up to 256 KB · 5 files at most
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={REQUEST_FILE_ACCEPT}
          aria-describedby={hintId}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      {errors.length > 0 ? (
        <ul role="alert" className="space-y-0.5 text-xs text-danger">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((picked) => (
            <li
              key={picked.key}
              className="relative min-w-0 overflow-hidden rounded-card border border-line bg-surface"
            >
              {picked.contentType.startsWith('image/') ? (
                <Thumbnail file={picked.file} />
              ) : (
                <span className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-surface-muted text-fg-muted">
                  <span className="font-mono text-xs font-semibold">MD</span>
                  <span className="text-xs">Markdown</span>
                </span>
              )}
              <span className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <span className="min-w-0 truncate text-label text-fg-secondary">
                  {picked.file.name}
                </span>
                <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                  {formatBytes(picked.file.size)}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${picked.file.name}`}
                onClick={() => {
                  setErrors([]);
                  onChange(files.filter((f) => f.key !== picked.key));
                }}
                className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-surface text-fg-muted shadow-card transition-colors hover:text-fg pointer-coarse:size-9"
              >
                <XIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Thumbnail({ file }: { file: File }) {
  // The preview URL lives only while this thumbnail is shown.
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (img.current) img.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <img ref={img} alt="" className="aspect-video w-full bg-surface-muted object-cover" />;
}

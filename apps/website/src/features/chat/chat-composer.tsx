'use client';

import type { ProjectMember, Task } from '@devtrack/types';
import { MAX_CHAT_ATTACHMENT_BYTES } from '@devtrack/validators';
import { useSearchParams } from 'next/navigation';
import { useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { PaperclipIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { getChatDraft, setChatDraft } from './chat-drafts';

interface ChatComposerProps {
  projectId: string;
  members: ProjectMember[];
  readOnly: boolean;
  onSend: (body: string, taskId?: string, file?: File) => Promise<void>;
  sending: boolean;
}

export function ChatComposer({ projectId, members, readOnly, onSend, sending }: ChatComposerProps) {
  const searchParams = useSearchParams();
  const preselectedTaskId = searchParams.get('task') ?? undefined;

  const [body, setBody] = useState(() => getChatDraft(projectId)?.body ?? '');
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(
    () => getChatDraft(projectId)?.taskId ?? preselectedTaskId,
  );
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const fileInputId = useId();
  const hintId = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch project tasks for the task selector
  const tasksQuery = useApiQuery<{ data?: Task[]; items?: Task[] } | Task[]>(
    showTaskPicker || preselectedTaskId ? `/projects/${projectId}/tasks?limit=50` : null,
  );

  const projectTasks: Task[] = Array.isArray(tasksQuery.data)
    ? tasksQuery.data
    : ((tasksQuery.data as { data?: Task[]; items?: Task[] })?.data ??
      (tasksQuery.data as { data?: Task[]; items?: Task[] })?.items ??
      []);

  // Save draft on changes
  const updateBody = (newBody: string) => {
    setBody(newBody);
    setChatDraft(projectId, { body: newBody, taskId: selectedTaskId });
  };

  const updateTaskId = (newTaskId: string | undefined) => {
    setSelectedTaskId(newTaskId);
    setChatDraft(projectId, { body, taskId: newTaskId });
  };

  // Filter mention suggestions
  const filteredMembers =
    mentionQuery !== null
      ? members.filter(
          (m) =>
            m.user.username.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
            m.user.username.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    updateBody(val);

    const cursor = e.target.selectionStart;
    setMentionCursorPos(cursor);

    // Check if typing a mention: look backwards from cursor to find '@'
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/(?:^|\s)@([A-Za-z0-9_-]*)$/);
    if (match) {
      setMentionQuery(match[1] ?? '');
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (username: string) => {
    if (!textareaRef.current) return;
    const cursor = mentionCursorPos;
    const textBefore = body.slice(0, cursor);
    const textAfter = body.slice(cursor);

    const match = textBefore.match(/(?:^|\s)@([A-Za-z0-9_-]*)$/);
    if (!match) return;

    const atIndex = textBefore.lastIndexOf('@');
    const newTextBefore = textBefore.slice(0, atIndex) + `@${username} `;
    const nextBody = newTextBefore + textAfter;

    updateBody(nextBody);
    setMentionQuery(null);

    setTimeout(() => {
      if (textareaRef.current) {
        const nextPos = newTextBefore.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // If composition input (e.g. CJK IME), do not trigger send or mention navigation
    if (e.nativeEvent.isComposing) return;

    if (mentionQuery !== null && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredMembers[mentionIndex];
        if (selected) {
          insertMention(selected.user.username);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    const trimmed = body.trim();
    if ((!trimmed && !file) || sending || readOnly) return;

    try {
      await onSend(trimmed, selectedTaskId, file);
      setBody('');
      setSelectedTaskId(undefined);
      clearFile();
      setChatDraft(projectId, { body: '' });
      setMentionQuery(null);
    } catch {
      setFileError('Could not read the file. Choose it again and retry.');
    }
  };

  function clearFile() {
    setFile(undefined);
    setFileError(undefined);
    if (fileInput.current) fileInput.current.value = '';
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const choice = event.currentTarget.files?.[0];
    if (!choice) return;
    if (!/\.md$/i.test(choice.name) || choice.size < 1 || choice.size > MAX_CHAT_ATTACHMENT_BYTES) {
      clearFile();
      setFileError('Choose a non-empty Markdown (.md) file up to 32 KiB.');
      return;
    }
    setFileError(undefined);
    setFile(choice);
  }

  const selectedTask = projectTasks.find((t) => t.id === selectedTaskId);

  if (readOnly) {
    return (
      <div className="rounded-card border border-line bg-surface-sunken p-4 text-center text-sm text-fg-subtle">
        This project is archived. New messages cannot be sent.
      </div>
    );
  }

  return (
    <div className="relative rounded-panel border border-line-control bg-surface p-3 shadow-card focus-within:border-primary">
      {/* Mention autocomplete dropdown */}
      {mentionQuery !== null && filteredMembers.length > 0 ? (
        <div
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute bottom-full mb-1 left-3 z-30 max-h-48 w-64 overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-lg"
        >
          {filteredMembers.map((m, idx) => (
            <button
              key={m.user.id}
              type="button"
              role="option"
              aria-selected={idx === mentionIndex}
              onClick={() => insertMention(m.user.username)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                idx === mentionIndex ? 'bg-surface-muted font-medium' : 'hover:bg-surface-sunken'
              }`}
            >
              <span className="font-semibold text-fg">@{m.user.username}</span>
              {m.user.jobTitle ? (
                <span className="truncate text-xs text-fg-muted">{m.user.jobTitle}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Selected task preview */}
      {selectedTaskId ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded bg-surface-muted px-2.5 py-1 text-xs">
          <span className="truncate font-medium text-fg-secondary">
            Linked Task:{' '}
            {selectedTask ? `${selectedTask.key} — ${selectedTask.title}` : selectedTaskId}
          </span>
          <button
            type="button"
            onClick={() => updateTaskId(undefined)}
            className="shrink-0 text-fg-subtle hover:text-fg"
            aria-label="Remove linked task"
          >
            ✕
          </button>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        rows={1}
        value={body}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        aria-label="Message"
        aria-describedby={hintId}
        placeholder="Message"
        className="block max-h-40 min-h-6 w-full resize-none border-0 bg-transparent p-0 text-base outline-none field-sizing-content placeholder:text-fg-subtle focus:ring-0 lg:text-sm"
      />

      {file ? (
        <div className="mt-2 flex max-w-full items-center gap-2 rounded-chip bg-surface-muted px-2.5 py-1 text-xs">
          <PaperclipIcon size={12} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 truncate font-medium text-fg-secondary">{file.name}</span>
          <button
            type="button"
            onClick={clearFile}
            disabled={sending}
            aria-label={`Remove ${file.name}`}
            className="touch-target shrink-0 text-fg-subtle hover:text-fg"
          >
            ✕
          </button>
        </div>
      ) : null}
      {fileError ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {fileError}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line-subtle pt-2">
        <div className="flex min-w-0 items-center gap-1">
          {/* The real file input stays focusable; the label is its visible button. */}
          <input
            id={fileInputId}
            ref={fileInput}
            type="file"
            accept=".md"
            onChange={selectFile}
            disabled={sending}
            className="peer sr-only"
          />
          <label
            htmlFor={fileInputId}
            title="Attach a Markdown file (.md, up to 32 KiB)"
            className="touch-target inline-flex size-8 cursor-pointer items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-disabled:cursor-default peer-disabled:opacity-50"
          >
            <PaperclipIcon size={16} />
            <span className="sr-only">Attach a Markdown file (.md, up to 32 KiB)</span>
          </label>
          {showTaskPicker ? (
            <select
              aria-label="Link a task"
              value={selectedTaskId ?? ''}
              onChange={(e) => {
                updateTaskId(e.target.value || undefined);
                setShowTaskPicker(false);
              }}
              className="min-w-0 max-w-full rounded border border-line-control bg-surface px-2 py-1 text-xs"
            >
              <option value="">No task linked</option>
              {projectTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.key} — {t.title}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setShowTaskPicker(true)}
              className="inline-flex h-8 items-center rounded-control px-2 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg pointer-coarse:h-11"
            >
              + Link task
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span id={hintId} className="hidden text-xs text-fg-subtle lg:inline">
            Enter to send · Shift+Enter for a new line · @ to mention
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={(!body.trim() && !file) || sending}
            onClick={handleSubmit}
          >
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}

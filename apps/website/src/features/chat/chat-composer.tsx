'use client';

import type { ProjectMember, Task } from '@devtrack/types';
import { useSearchParams } from 'next/navigation';
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { getChatDraft, setChatDraft } from './chat-drafts';

interface ChatComposerProps {
  projectId: string;
  members: ProjectMember[];
  readOnly: boolean;
  onSend: (body: string, taskId?: string) => Promise<void>;
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
    if (!trimmed || sending || readOnly) return;

    try {
      await onSend(trimmed, selectedTaskId);
      setBody('');
      setSelectedTaskId(undefined);
      setChatDraft(projectId, { body: '' });
      setMentionQuery(null);
    } catch {
      // Body is preserved on error
    }
  };

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
        rows={2}
        value={body}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="Type a message… (Enter to send, Shift+Enter for new line, @ to mention)"
        className="w-full resize-none border-0 bg-transparent p-0 text-sm outline-none placeholder:text-fg-subtle focus:ring-0"
      />

      <div className="mt-2 flex items-center justify-between gap-2 pt-1 border-t border-line-subtle">
        <div className="flex items-center gap-2">
          {showTaskPicker ? (
            <select
              aria-label="Link a task"
              value={selectedTaskId ?? ''}
              onChange={(e) => {
                updateTaskId(e.target.value || undefined);
                setShowTaskPicker(false);
              }}
              className="rounded border border-line-control bg-surface px-2 py-1 text-xs"
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
              className="text-xs font-medium text-fg-muted hover:text-fg"
            >
              + Link task
            </button>
          )}
        </div>

        <Button
          variant="primary"
          size="sm"
          disabled={!body.trim() || sending}
          onClick={handleSubmit}
        >
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}

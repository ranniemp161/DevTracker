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
      <div className="rounded-xl border border-border bg-subtle/50 p-4 text-center text-xs text-mineral">
        This project is archived. New messages cannot be sent.
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-border bg-surface p-3 shadow-xs focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 transition-all">
      {/* Mention autocomplete dropdown */}
      {mentionQuery !== null && filteredMembers.length > 0 ? (
        <div
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute bottom-full mb-1 left-2 z-30 max-h-48 w-64 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          {filteredMembers.map((m, idx) => (
            <button
              key={m.user.id}
              type="button"
              role="option"
              aria-selected={idx === mentionIndex}
              onClick={() => insertMention(m.user.username)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                idx === mentionIndex
                  ? 'bg-accent-tint/60 font-semibold text-accent-text'
                  : 'hover:bg-subtle text-graphite'
              }`}
            >
              <span className="font-semibold">@{m.user.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Selected task preview */}
      {selectedTaskId ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-subtle px-2.5 py-1 text-xs">
          <span className="truncate font-medium text-graphite">
            <span className="text-mineral mr-1">Linked Task:</span>
            {selectedTask ? `${selectedTask.key} — ${selectedTask.title}` : selectedTaskId}
          </span>
          <button
            type="button"
            onClick={() => updateTaskId(undefined)}
            className="shrink-0 text-mineral hover:text-graphite cursor-pointer"
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
        placeholder="Type a message… (@ to mention, # or link to reference a task)"
        className="w-full resize-none border-0 bg-transparent p-0 text-xs sm:text-sm text-graphite outline-none placeholder:text-mineral-muted focus:ring-0 leading-relaxed"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
        <div className="flex items-center gap-2">
          {showTaskPicker ? (
            <select
              aria-label="Link a task"
              value={selectedTaskId ?? ''}
              onChange={(e) => {
                updateTaskId(e.target.value || undefined);
                setShowTaskPicker(false);
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-graphite focus:border-accent focus:outline-none cursor-pointer"
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
              className="inline-flex items-center gap-1 text-xs font-medium text-mineral hover:text-accent transition-colors cursor-pointer"
            >
              <svg aria-hidden="true" className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
                <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
              </svg>
              <span>+ Link task</span>
            </button>
          )}

          <span className="text-[11px] text-mineral-muted hidden md:inline ml-2">
            Enter to send · Shift+Enter for new line
          </span>
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

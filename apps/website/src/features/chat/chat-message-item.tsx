'use client';

import type { ProjectMessage, PublicUser } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar, Badge, Button } from '@/components/ui';
import { TASK_STATUS_LABEL } from '../projects/labels';

export interface OptimisticChatMessage extends ProjectMessage {
  status?: 'sending' | 'failed' | 'sent';
  errorMessage?: string;
}

interface ChatMessageItemProps {
  message: OptimisticChatMessage;
  currentUser: PublicUser;
  canManage: boolean;
  readOnly: boolean;
  isTarget?: boolean;
  onEdit: (messageId: string, newBody: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onRetry?: (message: OptimisticChatMessage) => void;
}

export function ChatMessageItem({
  message,
  currentUser,
  canManage,
  readOnly,
  isTarget,
  onEdit,
  onDelete,
  onRetry,
}: ChatMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body ?? '');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [highlighted, setHighlighted] = useState(isTarget);

  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isTarget) {
      if (itemRef.current) {
        itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const timer = setTimeout(() => {
        setHighlighted(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isTarget]);

  const isAuthor = currentUser.id === message.author?.id;
  const canDelete = !readOnly && !message.deleted && (isAuthor || canManage);
  const canEdit =
    !readOnly &&
    !message.deleted &&
    isAuthor &&
    message.status !== 'sending' &&
    message.status !== 'failed';

  const handleSaveEdit = async () => {
    const trimmed = editBody.trim();
    if (!trimmed || savingEdit) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      await onEdit(message.id, trimmed);
      setIsEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to update message.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(message.id);
      setConfirmDelete(false);
    } catch {
      // Keep confirm open on failure
    } finally {
      setDeleting(false);
    }
  };

  const formattedTime = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div
      ref={itemRef}
      id={`message-${message.id}`}
      className={`group flex items-start gap-3 rounded-xl p-3 transition-colors ${
        highlighted ? 'bg-amber-50/80 ring-2 ring-amber-400/80' : 'hover:bg-subtle/40'
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <Avatar
          name={message.author?.username ?? 'User'}
          url={message.author?.avatarUrl ?? null}
          size="sm"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold text-graphite">
            {message.author ? `@${message.author.username}` : 'Former member'}
          </span>
          <span className="text-[11px] text-mineral-muted">{formattedTime}</span>
          {message.edited && !message.deleted ? (
            <span className="text-[11px] text-mineral-muted italic">(edited)</span>
          ) : null}

          {message.status === 'sending' ? (
            <span className="text-[11px] font-medium text-mineral-muted">Sending…</span>
          ) : null}

          {message.status === 'failed' ? (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-red-600">
              Failed
              {onRetry ? (
                <button
                  type="button"
                  onClick={() => onRetry(message)}
                  className="font-bold underline hover:text-red-800 cursor-pointer"
                >
                  Retry
                </button>
              ) : null}
            </span>
          ) : null}

          {/* Action buttons on hover/focus */}
          {!isEditing && (canEdit || canDelete) ? (
            <div className="ml-auto opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-1 transition-opacity">
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditBody(message.body ?? '');
                    setIsEditing(true);
                  }}
                  className="rounded px-1.5 py-0.5 text-xs text-mineral hover:bg-subtle hover:text-graphite cursor-pointer"
                >
                  Edit
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  Delete
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Message body / edit / deleted placeholder */}
        {message.deleted ? (
          <p className="mt-1 text-xs italic text-mineral-muted">This message was deleted.</p>
        ) : isEditing ? (
          <div className="mt-2 space-y-2">
            <textarea
              rows={2}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full rounded-lg border border-border p-2.5 text-xs text-graphite outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {editError ? <p className="text-xs text-red-600">{editError}</p> : null}
            <div className="flex items-center gap-2">
              <Button size="xs" variant="primary" disabled={savingEdit} onClick={handleSaveEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </Button>
              <Button
                size="xs"
                variant="secondary"
                disabled={savingEdit}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-graphite break-words whitespace-pre-wrap leading-relaxed">
            {renderMessageWithMentions(message.body ?? '')}
          </div>
        )}

        {/* Linked task compact preview */}
        {!message.deleted && message.task ? (
          <div className="mt-2">
            <Link
              href={`/projects/${message.projectId}/tasks/${message.task.id}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-subtle/50 px-2.5 py-1 text-xs hover:border-accent hover:bg-accent-tint/30 transition-colors"
            >
              <span className="font-mono font-semibold text-accent">{message.task.key}</span>
              <span className="max-w-[200px] truncate text-mineral sm:max-w-xs">
                {message.task.title}
              </span>
              <Badge tone={message.task.status === 'DONE' ? 'green' : 'neutral'}>
                {TASK_STATUS_LABEL[message.task.status]}
              </Badge>
            </Link>
          </div>
        ) : null}

        {/* Delete confirmation prompt */}
        {confirmDelete ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-800 border border-red-200">
            <span>Delete this message?</span>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="font-bold underline hover:text-red-950 cursor-pointer"
            >
              {deleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
              className="text-mineral hover:text-graphite cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderMessageWithMentions(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(?:^|\s)@([A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?)/g;

  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0];
    const username = match[1];
    const matchIndex = match.index;

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    const leadingSpace = fullMatch.startsWith(' ') ? ' ' : '';
    parts.push(leadingSpace);
    parts.push(
      <span
        key={`${matchIndex}-${username}`}
        className="font-semibold text-accent-text bg-accent-tint/80 px-1.5 py-0.5 rounded-md"
      >
        @{username}
      </span>,
    );
    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

'use client';

import type { ProjectMessage, PublicUser } from '@devtrack/types';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertIcon,
  ChevronRightIcon,
  MoreIcon,
  PullRequestIcon,
  TagIcon,
} from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';
import { Avatar, Button, StatusDot } from '@/components/ui';
import { api } from '@/lib/api';
import type { CreateChatMessageInput } from '@devtrack/validators';
import { TASK_STATUS_LABEL } from '../projects/labels';

export interface OptimisticChatMessage extends ProjectMessage {
  status?: 'sending' | 'failed' | 'sent';
  errorMessage?: string;
  pendingInput?: CreateChatMessageInput;
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
  const [downloadError, setDownloadError] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function downloadAttachment() {
    setDownloadError(false);
    setDownloading(true);
    try {
      const { url } = await api<{ url: string }>(`/messages/${message.id}/attachment`);
      window.location.assign(url);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }
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
  const canDelete =
    !readOnly && !message.deleted && !message.pendingInput && (isAuthor || canManage);
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

  // GitHub updates (decision record 0014): a compact event row, no author or edit.
  if (message.kind === 'github' && message.github && !message.deleted) {
    const g = message.github;
    const link = g.pullRequest
      ? { url: g.pullRequest.url, text: `#${g.pullRequest.number} ${g.pullRequest.title}` }
      : g.release
        ? { url: g.release.url, text: g.release.name ?? g.release.tag }
        : null;
    const Icon = g.release ? TagIcon : g.event === 'checks.failed' ? AlertIcon : PullRequestIcon;
    return (
      <div
        ref={itemRef}
        id={`message-${message.id}`}
        className={`group flex items-start gap-3 rounded-card px-2.5 py-1.5 text-sm transition-colors ${
          highlighted ? 'bg-status-todo-bg ring-2 ring-status-todo' : 'hover:bg-surface-sunken'
        }`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
            g.event === 'checks.failed' || g.event === 'review.changes_requested'
              ? 'bg-danger-soft text-danger'
              : g.event === 'pull_request.merged'
                ? 'bg-status-review-bg text-pr-merged'
                : 'bg-surface-muted text-fg-secondary'
          }`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-fg-secondary">
            <span className="font-medium text-fg">{GITHUB_EVENT_TEXT[g.event]}</span>
            {link ? (
              <>
                {' '}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {link.text}
                </a>
              </>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            <span className="font-mono">{g.repository}</span>
            {g.sender ? ` · ${g.sender}` : ''} · {formattedTime}
          </p>
          {confirmDelete ? (
            <div className="mt-2 flex items-center gap-2 rounded-chip bg-status-blocked-bg p-2 text-xs text-danger">
              <span>Delete this update?</span>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="font-bold underline"
              >
                {deleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(false)}
                className="text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
        {canDelete && !confirmDelete ? (
          <MessageActions label="GitHub update actions" onDelete={() => setConfirmDelete(true)} />
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={itemRef}
      id={`message-${message.id}`}
      className={`group flex items-start gap-3 rounded-card p-2.5 transition-colors ${
        highlighted ? 'bg-status-todo-bg ring-2 ring-status-todo' : 'hover:bg-surface-sunken'
      }`}
    >
      <div className="shrink-0 pt-0.5">
        <Avatar
          name={message.author?.username ?? 'User'}
          url={message.author?.avatarUrl ?? null}
          size="sm"
          seed={message.author?.id}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-fg">
            {message.author ? `@${message.author.username}` : 'Former member'}
          </span>
          <span className="text-xs text-fg-subtle">{formattedTime}</span>
          {message.edited && !message.deleted ? (
            <span className="text-xs text-fg-subtle">(edited)</span>
          ) : null}

          {message.status === 'sending' ? (
            <span className="text-xs font-medium text-fg-muted">Sending…</span>
          ) : null}

          {message.status === 'failed' ? (
            <span className="flex items-center gap-1 text-xs font-medium text-danger">
              {message.errorMessage ?? 'Failed'}
              {onRetry ? (
                <button
                  type="button"
                  onClick={() => onRetry(message)}
                  className="font-semibold underline hover:text-danger"
                >
                  Retry
                </button>
              ) : null}
            </span>
          ) : null}

          {!isEditing && (canEdit || canDelete) ? (
            <MessageActions
              label="Message actions"
              onEdit={
                canEdit
                  ? () => {
                      setEditBody(message.body ?? '');
                      setIsEditing(true);
                    }
                  : undefined
              }
              onDelete={canDelete ? () => setConfirmDelete(true) : undefined}
            />
          ) : null}
        </div>

        {/* Message body / edit / deleted placeholder */}
        {message.deleted ? (
          <p className="mt-1 text-sm italic text-fg-muted">This message was deleted.</p>
        ) : isEditing ? (
          <div className="mt-2 space-y-2">
            <textarea
              rows={2}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full rounded border border-line-control p-2 text-sm outline-none focus:border-fg"
            />
            {editError ? <p className="text-xs text-danger">{editError}</p> : null}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={savingEdit} onClick={handleSaveEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={savingEdit}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-md leading-relaxed text-fg-secondary break-words whitespace-pre-wrap">
            {renderMessageWithMentions(message.body ?? '')}
          </div>
        )}

        {!message.deleted && message.attachment ? (
          <div className="mt-2">
            {message.pendingInput ? (
              <span className="break-all text-sm text-fg-muted">{message.attachment.name}</span>
            ) : (
              <button
                type="button"
                onClick={downloadAttachment}
                disabled={downloading}
                className="break-all text-left text-sm text-primary underline"
              >
                {downloading ? 'Preparing download…' : `Download ${message.attachment.name}`}
              </button>
            )}
            {downloadError ? (
              <p role="alert" className="text-xs text-danger">
                Could not download the file. Try again.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Linked task badge */}
        {!message.deleted && message.task ? (
          <div className="mt-2">
            <Link
              href={`/projects/${message.projectId}/tasks/${message.task.id}`}
              className="flex max-w-md items-center gap-3 rounded-card border border-line bg-surface-sunken px-3 py-2 transition-colors hover:border-line-control"
            >
              <StatusDot status={message.task.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">
                  {message.task.title}
                </span>
                <span className="block text-xs text-fg-muted">
                  <span className="font-mono">{message.task.key}</span> ·{' '}
                  {TASK_STATUS_LABEL[message.task.status]}
                </span>
              </span>
              <ChevronRightIcon size={14} className="shrink-0 text-fg-subtle" />
            </Link>
          </div>
        ) : null}

        {/* Delete confirmation prompt */}
        {confirmDelete ? (
          <div className="mt-2 flex items-center gap-2 rounded bg-status-blocked-bg p-2 text-xs text-danger">
            <span>Delete this message?</span>
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="font-bold underline hover:text-danger"
            >
              {deleting ? 'Deleting…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => setConfirmDelete(false)}
              className="text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Edit/Delete behind one "⋯" button, so actions never squeeze the message text.
 * Shown on hover or keyboard focus with a mouse; always shown on touch screens, which can't hover.
 */
function MessageActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Menu
      label={label}
      align="end"
      triggerProps={{ 'aria-label': label }}
      triggerClassName="touch-target ml-auto inline-flex size-7 shrink-0 items-center justify-center self-start rounded-control text-fg-muted opacity-0 transition-opacity hover:bg-surface-muted hover:text-fg group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:bg-surface-muted aria-expanded:opacity-100 pointer-coarse:opacity-100"
      menuClassName="w-40"
      trigger={<MoreIcon size={16} />}
    >
      {onEdit ? <MenuItem onSelect={onEdit}>Edit</MenuItem> : null}
      {onDelete ? (
        <MenuItem
          onSelect={onDelete}
          className="text-danger! hover:text-danger! focus-visible:text-danger!"
        >
          Delete
        </MenuItem>
      ) : null}
    </Menu>
  );
}

const GITHUB_EVENT_TEXT: Record<NonNullable<ProjectMessage['github']>['event'], string> = {
  'pull_request.opened': 'Pull request opened',
  'pull_request.merged': 'Pull request merged',
  'pull_request.closed': 'Pull request closed',
  'review.changes_requested': 'Changes requested on',
  'review.approved': 'Approved',
  'release.published': 'Release published',
  'checks.failed': 'Checks failed on',
};

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
      <span key={`${matchIndex}-${username}`} className="font-medium text-primary">
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

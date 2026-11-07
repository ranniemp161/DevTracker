'use client';

import type { Comment, Task } from '@devtrack/types';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Avatar, Button } from '@/components/ui';
import { api, apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useProject } from '../projects/project-context';
import { useSession } from '../session/session-context';
import { timeAgo } from './describe-activity';

const textareaClass =
  'block w-full rounded-control border border-line-control bg-surface px-3 py-2 text-sm placeholder:text-fg-subtle focus-visible:border-primary';

/**
 * Renders plain text (never HTML) and highlights `@mentions` that resolved to real people.
 * React escapes all text, so comment bodies cannot inject markup (M4 rule 1).
 */
function CommentBody({ comment }: { comment: Comment }) {
  const known = new Set(comment.mentions.map((m) => m.username));
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of (comment.body ?? '').matchAll(/@([A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9])/g)) {
    const username = match[1]!.toLowerCase();
    if (!known.has(username)) continue;
    parts.push(comment.body!.slice(last, match.index));
    parts.push(
      <span key={match.index} className="font-medium text-primary">
        {match[0]}
      </span>,
    );
    last = match.index! + match[0].length;
  }
  parts.push((comment.body ?? '').slice(last));
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-fg-secondary">
      {parts}
    </p>
  );
}

export function CommentThread({ task, onActivity }: { task: Task; onActivity: () => void }) {
  const { user } = useSession();
  const { project, readOnly } = useProject();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [version, setVersion] = useState(0);
  // Live updates (M7): comments posted or deleted by others.
  useRealtimeRefresh(
    (e) => e.type.startsWith('comment.') && e.payload.taskId === task.id,
    () => setVersion((v) => v + 1),
  );

  useEffect(() => {
    let cancelled = false;
    apiPage<Comment>(`/tasks/${task.id}/comments?limit=50`).then(
      (page) => {
        if (cancelled) return;
        setComments(page.items);
        setCursor(page.nextCursor);
      },
      (err: unknown) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load comments.'),
    );
    return () => {
      cancelled = true;
    };
  }, [task.id, version]);

  async function loadMore() {
    if (!cursor) return;
    const page = await apiPage<Comment>(
      `/tasks/${task.id}/comments?limit=50&cursor=${encodeURIComponent(cursor)}`,
    );
    setComments((c) => [...(c ?? []), ...page.items]);
    setCursor(page.nextCursor);
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      onActivity();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Something went wrong.',
      );
    }
  }

  function post(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setPosting(true);
    void run(async () => {
      const { comment } = await api<{ comment: Comment }>(`/tasks/${task.id}/comments`, {
        body: { body: draft },
      });
      // Only append when every page is loaded, so the thread stays in order.
      if (!cursor) setComments((c) => [...(c ?? []), comment]);
      setDraft('');
    }).finally(() => setPosting(false));
  }

  const replace = (updated: Comment) =>
    setComments((c) => c?.map((x) => (x.id === updated.id ? updated : x)) ?? null);

  return (
    <section aria-labelledby="comments-heading" className="space-y-4">
      <h2 id="comments-heading" className="text-md font-semibold">
        Comments
      </h2>
      {error ? <Alert>{error}</Alert> : null}
      {!comments ? <p className="text-sm text-fg-subtle">Loading comments…</p> : null}
      {comments?.length === 0 ? <p className="text-sm text-fg-subtle">No comments yet.</p> : null}
      <ol className="space-y-4">
        {comments?.map((c) => {
          const mine = c.author?.id === user.id;
          const canDelete = !readOnly && !c.deleted && (mine || project.viewerCanManage);
          return (
            <li key={c.id} className="flex gap-3">
              <Avatar
                name={c.author?.username ?? '?'}
                url={c.author?.avatarUrl ?? null}
                seed={c.author?.id}
                size="sm"
              />
              <div className="min-w-0 flex-1 rounded-card border border-line bg-surface px-3.5 py-2.5">
                <p className="text-xs text-fg-muted">
                  <span className="text-label font-semibold text-fg">
                    @{c.author?.username ?? 'deleted user'}
                  </span>{' '}
                  ·{' '}
                  <span title={new Date(c.createdAt).toLocaleString()}>{timeAgo(c.createdAt)}</span>
                  {c.edited && !c.deleted ? ' · edited' : ''}
                </p>
                {c.deleted ? (
                  <p className="mt-1 text-sm text-fg-subtle italic">This comment was deleted.</p>
                ) : editing?.id === c.id ? (
                  <form
                    className="mt-2 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const { comment } = await api<{ comment: Comment }>(`/comments/${c.id}`, {
                          method: 'PATCH',
                          body: { body: editing.body },
                        });
                        replace(comment);
                        setEditing(null);
                      });
                    }}
                  >
                    <textarea
                      rows={3}
                      value={editing.body}
                      maxLength={10_000}
                      aria-label="Edit comment"
                      onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                      className={textareaClass}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        variant="primary"
                        disabled={!editing.body.trim()}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-1">
                    <CommentBody comment={c} />
                  </div>
                )}
                {!c.deleted && editing?.id !== c.id && (mine || canDelete) && !readOnly ? (
                  <div className="mt-1 flex gap-1">
                    {mine ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: c.id, body: c.body ?? '' })}
                      >
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          run(async () => {
                            await api(`/comments/${c.id}`, { method: 'DELETE' });
                            replace({ ...c, body: null, deleted: true, mentions: [] });
                          })
                        }
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {cursor ? (
        <Button size="sm" onClick={loadMore}>
          Load older comments
        </Button>
      ) : null}
      {readOnly ? null : (
        <form onSubmit={post} className="space-y-2">
          <label htmlFor="new-comment" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="new-comment"
            rows={3}
            value={draft}
            maxLength={10_000}
            placeholder="Add a comment… Use @username to mention someone on this project."
            onChange={(e) => setDraft(e.target.value)}
            className={textareaClass}
          />
          <Button type="submit" variant="primary" disabled={posting || !draft.trim()}>
            {posting ? 'Posting…' : 'Comment'}
          </Button>
        </form>
      )}
    </section>
  );
}

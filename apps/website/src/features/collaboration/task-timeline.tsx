'use client';

import type { Comment, Task, TimelineItem } from '@devtrack/types';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Avatar, Button, SegmentedControl } from '@/components/ui';
import { api, apiPage, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useProject } from '../projects/project-context';
import { useSession } from '../session/session-context';
import { actorLabel } from './activity-feed';
import { describeActivity, timeAgo } from './describe-activity';
import { appendTimeline, parseTimelineFilter, type TimelineFilter } from './timeline-items';

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

/**
 * Task detail Activity (SPEC §5): comments and history in one timeline, oldest first, with an
 * All | Comments switch kept in the URL (`?activity=comments`). The API merges and pages both
 * sources (GET /tasks/:id/timeline), so pages never overlap or leave gaps.
 */
export function TaskTimeline({
  task,
  refreshKey,
  onActivity,
}: {
  task: Task;
  /** Changes when the task is saved, so new history entries load. */
  refreshKey: string;
  onActivity: () => void;
}) {
  const { user } = useSession();
  const { project, readOnly } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = parseTimelineFilter(searchParams.get('activity'));
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [version, setVersion] = useState(0);
  // Live updates (M7): comments and changes made by others on this task.
  useRealtimeRefresh(
    (e) =>
      (e.type.startsWith('comment.') || e.type === 'activity.created') &&
      e.payload.taskId === task.id,
    () => setVersion((v) => v + 1),
  );

  const base = `/tasks/${task.id}/timeline?kind=${filter}&limit=50`;
  useEffect(() => {
    let cancelled = false;
    apiPage<TimelineItem>(base).then(
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      },
      (err: unknown) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load activity.'),
    );
    return () => {
      cancelled = true;
    };
  }, [base, version, refreshKey]);

  async function loadMore() {
    if (!cursor) return;
    const page = await apiPage<TimelineItem>(`${base}&cursor=${encodeURIComponent(cursor)}`);
    setItems((current) => appendTimeline(current ?? [], page.items));
    setCursor(page.nextCursor);
  }

  function setFilter(next: TimelineFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('activity');
    else params.set('activity', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
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
      // Only append when every page is loaded, so the timeline stays in order.
      if (!cursor)
        setItems((current) => appendTimeline(current ?? [], [{ kind: 'comment', comment }]));
      setDraft('');
    }).finally(() => setPosting(false));
  }

  const replace = (updated: Comment) =>
    setItems((current) => appendTimeline(current ?? [], [{ kind: 'comment', comment: updated }]));

  return (
    <section aria-labelledby="activity-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="activity-heading" className="text-md font-semibold">
          Activity
        </h2>
        <SegmentedControl
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'comments', label: 'Comments' },
          ]}
        />
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {!items ? <p className="text-sm text-fg-subtle">Loading activity…</p> : null}
      {items?.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          {filter === 'comments' ? 'No comments yet.' : 'No activity yet.'}
        </p>
      ) : null}
      <ol className="space-y-4">
        {items?.map((item) => {
          if (item.kind === 'activity') {
            const e = item.entry;
            return (
              <li key={`activity:${e.id}`} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center"
                >
                  <span className="size-2 rounded-full bg-line-control" />
                </span>
                <p className="min-w-0 pt-1.5 text-label text-fg-muted">
                  <span className="font-semibold text-fg">{actorLabel(e)}</span>{' '}
                  {describeActivity(e)} ·{' '}
                  <span title={new Date(e.createdAt).toLocaleString()}>{timeAgo(e.createdAt)}</span>
                </p>
              </li>
            );
          }
          const c = item.comment;
          const mine = c.author?.id === user.id;
          const canDelete = !readOnly && !c.deleted && (mine || project.viewerCanManage);
          return (
            <li key={`comment:${c.id}`} className="flex gap-3">
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
          Load more
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            aria-describedby="new-comment-hint"
            className={textareaClass}
          />
          <div className="flex items-center justify-between gap-3">
            <p id="new-comment-hint" className="text-xs text-fg-subtle">
              Ctrl/⌘ + Enter to send
            </p>
            <Button type="submit" variant="primary" disabled={posting || !draft.trim()}>
              {posting ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

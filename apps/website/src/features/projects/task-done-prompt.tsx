'use client';

import type { TaskDonePrompt } from '@devtrack/types';
import { useState } from 'react';
import { PullRequestIcon } from '@/components/icons';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';
import { useApiQuery } from '@/lib/use-api-query';
import { useProject } from './project-context';

/**
 * "PR #42 was merged. Mark DEV-104 done?" (decision record 0021 §4). Shown while a merged,
 * linked pull request is waiting for someone to decide. DevTrack never marks the task Done on
 * its own; this asks. Hidden for people who can't edit the task.
 */
export function TaskDonePromptBanner({
  taskId,
  taskKey,
  onChanged,
}: {
  taskId: string;
  taskKey: string;
  onChanged: () => void;
}) {
  const { readOnly } = useProject();
  const path = `/tasks/${taskId}/done-prompts`;
  const query = useApiQuery<{ prompts: TaskDonePrompt[] }>(readOnly ? null : path);
  useRealtimeRefresh(
    (e) =>
      e.type === 'task.updated' &&
      e.payload.taskId === taskId &&
      ('donePrompt' in e.payload || 'changes' in e.payload),
    query.reload,
  );
  const [busy, setBusy] = useState<'done' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prompt = query.data?.prompts[0];
  if (readOnly || !prompt) return null;
  const more = (query.data?.prompts.length ?? 1) - 1;

  async function act(kind: 'done' | 'dismiss') {
    setBusy(kind);
    setError(null);
    try {
      await api(kind === 'done' ? `${path}/accept` : `${path}/${prompt!.id}/dismiss`, {
        method: 'POST',
      });
      query.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      query.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Pull request merged"
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-card border border-line bg-surface-sunken px-3.5 py-3"
    >
      <PullRequestIcon size={16} className="shrink-0 text-status-done-fg" />
      <p className="min-w-0 flex-1 text-sm text-fg-secondary">
        <a
          href={prompt.pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="font-mono font-medium text-fg hover:underline"
        >
          #{prompt.pullRequest.number}
        </a>{' '}
        was merged.{' '}
        <span className="font-medium text-fg">
          Mark <span className="font-mono">{taskKey}</span> done?
        </span>
        {more > 0 ? (
          <span className="text-fg-muted">
            {' '}
            ({more} more merged {more === 1 ? 'PR' : 'PRs'})
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="mt-1 block text-danger">
            {error}
          </span>
        ) : null}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          loading={busy === 'dismiss'}
          disabled={busy !== null}
          onClick={() => act('dismiss')}
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy === 'done'}
          disabled={busy !== null}
          onClick={() => act('done')}
        >
          Mark done
        </Button>
      </div>
    </section>
  );
}

'use client';

import type { TaskStatus, TaskTimeInStatus } from '@devtrack/types';
import { PanelSection, Skeleton, StatusDot } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDuration, TASK_STATUS_LABEL } from './labels';

/**
 * Time the task has spent in each status, from its real status history (SPEC §5, Task detail).
 * The parent re-mounts this when the task changes, which re-fetches it.
 */
export function TaskTime({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const { data, error } = useApiQuery<{ time: TaskTimeInStatus }>(
    `/tasks/${taskId}/time-in-status`,
  );

  return (
    <PanelSection title="Time in status">
      {error ? (
        <p className="text-label text-fg-subtle">Could not load the time in each status.</p>
      ) : !data ? (
        <Skeleton className="h-12" />
      ) : (
        <dl className="space-y-1.5 text-label">
          {data.time.totals.map((total) => (
            <div key={total.status} className="flex items-center gap-2">
              <dt className="flex min-w-0 flex-1 items-center gap-2 text-fg-secondary">
                <StatusDot status={total.status} />
                <span className="truncate">
                  {TASK_STATUS_LABEL[total.status]}
                  {total.status === status ? (
                    <span className="text-fg-subtle"> · current</span>
                  ) : null}
                </span>
              </dt>
              <dd className="shrink-0 text-fg tabular-nums">{formatDuration(total.seconds)}</dd>
            </div>
          ))}
          {data.time.cycleSeconds === null ? null : (
            <div className="flex items-center gap-2 border-t border-line pt-1.5">
              <dt className="min-w-0 flex-1 text-fg-muted">Start to done</dt>
              <dd className="shrink-0 font-medium text-fg tabular-nums">
                {formatDuration(data.time.cycleSeconds)}
              </dd>
            </div>
          )}
        </dl>
      )}
    </PanelSection>
  );
}

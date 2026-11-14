'use client';

import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Label,
  type ProjectMember,
  type Task,
} from '@devtrack/types';
import type { BulkUpdateTasksInput } from '@devtrack/validators';
import { useState } from 'react';
import { useToast } from '@/components/toaster';
import { Alert, Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from './labels';
import { FilterSelect } from './task-filters';
import { updatedLabel } from './task-selection';

type BulkChange = Omit<BulkUpdateTasksInput, 'taskIds'>;

/**
 * Sticky bar shown while tasks are selected in the List: apply one change to all of them,
 * all or nothing (PATCH /projects/:id/tasks/bulk). Errors keep the selection so it can be retried.
 */
export function BulkActionBar({
  projectId,
  workspaceId,
  members,
  selectedIds,
  onApplied,
  onClear,
}: {
  projectId: string;
  workspaceId: string;
  members: ProjectMember[];
  selectedIds: string[];
  onApplied: () => void;
  onClear: () => void;
}) {
  const toast = useToast();
  const labels = useApiQuery<Label[]>(`/workspaces/${workspaceId}/labels`).data ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(change: BulkChange) {
    setBusy(true);
    setError(null);
    try {
      const { tasks } = await api<{ tasks: Task[] }>(`/projects/${projectId}/tasks/bulk`, {
        method: 'PATCH',
        body: { taskIds: selectedIds, ...change },
      });
      toast.show(updatedLabel(tasks.length));
      onApplied();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Could not update these tasks.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      aria-busy={busy || undefined}
      className="sticky bottom-4 z-20 space-y-2 rounded-panel border border-line bg-surface p-3 shadow-overlay"
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-1 text-label font-medium text-fg">{selectedIds.length} selected</p>
        <FilterSelect
          label="Set status"
          value=""
          onChange={(v) => v && void apply({ status: v as BulkChange['status'] })}
        >
          <option value="">Status…</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABEL[s]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Set priority"
          value=""
          onChange={(v) => v && void apply({ priority: v as BulkChange['priority'] })}
        >
          <option value="">Priority…</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Assign"
          value=""
          onChange={(v) => v && void apply({ addAssigneeIds: [v] })}
        >
          <option value="">Assign…</option>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              @{m.user.username}
            </option>
          ))}
        </FilterSelect>
        {labels.length > 0 ? (
          <FilterSelect
            label="Add label"
            value=""
            onChange={(v) => v && void apply({ addLabelIds: [v] })}
          >
            <option value="">Label…</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onClear} disabled={busy} className="ml-auto">
          Clear selection
        </Button>
      </div>
    </div>
  );
}

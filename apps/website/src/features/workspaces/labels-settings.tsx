'use client';

import type { Label } from '@devtrack/types';
import { useState } from 'react';
import { Alert, Button, Card, EmptyState } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { LABEL_COLORS, LabelChip } from '../projects/label-chip';
import { useWorkspace } from './workspace-context';

/** Workspace Settings → Labels: admins rename, recolor and delete (members create from tasks). */
export function LabelsSettings() {
  const { workspace } = useWorkspace();
  const labels = useApiQuery<Label[]>(`/workspaces/${workspace.id}/labels`);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setEditing(null);
      labels.reload();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.details[0]?.message ?? err.message)
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Labels"
      description="Shared by every project in this workspace. Deleting a label removes it from all tasks."
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      {labels.data?.length === 0 ? (
        <EmptyState
          title="No labels yet"
          description="Members can create tags and labels from any task details page."
        />
      ) : null}
      <ul className="divide-y divide-border/60">
        {labels.data?.map((l) =>
          editing?.id === l.id ? (
            <li key={l.id} className="flex flex-wrap items-center gap-2.5 py-3">
              <input
                value={editing.name}
                maxLength={40}
                aria-label="Label name"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-graphite focus:border-accent focus:outline-none"
              />
              <div className="flex gap-1.5" role="radiogroup" aria-label="Label color">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={editing.color === c}
                    aria-label={c}
                    onClick={() => setEditing({ ...editing, color: c })}
                    className={`size-5 rounded-full cursor-pointer transition-transform ${
                      editing.color === c
                        ? 'ring-2 ring-accent ring-offset-1 scale-110'
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Button
                size="xs"
                variant="primary"
                disabled={busy}
                onClick={() =>
                  call(() =>
                    api(`/labels/${l.id}`, {
                      method: 'PATCH',
                      body: { name: editing.name, color: editing.color },
                    }),
                  )
                }
              >
                Save
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </li>
          ) : (
            <li key={l.id} className="flex items-center justify-between gap-3 py-3">
              <LabelChip label={l} />
              <div className="flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setEditing({ id: l.id, name: l.name, color: l.color })}
                >
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => call(() => api(`/labels/${l.id}`, { method: 'DELETE' }))}
                  className="text-mineral hover:text-red-700"
                >
                  Delete
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}

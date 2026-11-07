'use client';

import type { Label } from '@devtrack/types';
import { useState } from 'react';
import { Alert, Button, SettingsSection } from '@/components/ui';
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
    <SettingsSection
      id="labels"
      title="Labels"
      description="Shared by every project in this workspace. Deleting a label removes it from all tasks."
    >
      {error ? <Alert>{error}</Alert> : null}
      {labels.data?.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          No labels yet. Members can create labels from any task.
        </p>
      ) : null}
      <ul className="divide-y divide-line-subtle">
        {labels.data?.map((l) =>
          editing?.id === l.id ? (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <input
                value={editing.name}
                maxLength={40}
                aria-label="Label name"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="rounded-control border border-line-control bg-surface px-2 py-1 text-sm"
              />
              <div className="flex gap-1" role="radiogroup" aria-label="Label color">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={editing.color === c}
                    aria-label={c}
                    onClick={() => setEditing({ ...editing, color: c })}
                    className={`size-5 rounded-full ${editing.color === c ? 'ring-2 ring-fg ring-offset-1' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <Button
                size="sm"
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
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </li>
          ) : (
            <li key={l.id} className="flex items-center gap-2 py-2.5">
              <LabelChip label={l} />
              <span className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing({ id: l.id, name: l.name, color: l.color })}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => call(() => api(`/labels/${l.id}`, { method: 'DELETE' }))}
              >
                Delete
              </Button>
            </li>
          ),
        )}
      </ul>
    </SettingsSection>
  );
}

'use client';

import type { Label, Task } from '@devtrack/types';
import { createLabelSchema } from '@devtrack/validators';
import { useState, type FormEvent } from 'react';
import { Button, Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { LABEL_COLORS, LabelChip } from './label-chip';
import { useProject } from './project-context';

/** Labels card on the task page: attach/detach workspace labels, or create one inline. */
export function TaskLabels({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const { project, readOnly } = useProject();
  const all = useApiQuery<Label[]>(`/workspaces/${project.workspaceId}/labels`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[5]!);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
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

  function createAndAttach(e: FormEvent) {
    e.preventDefault();
    const parsed = createLabelSchema.safeParse({ name, color });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid label.');
    void call(async () => {
      const { label } = await api<{ label: Label }>(`/workspaces/${project.workspaceId}/labels`, {
        body: parsed.data,
      });
      await api(`/tasks/${task.id}/labels`, { body: { labelId: label.id } });
      setName('');
      setCreating(false);
      all.reload();
    });
  }

  const available = (all.data ?? []).filter((l) => !task.labels.some((t) => t.id === l.id));

  return (
    <Card title="Labels">
      <div className="flex flex-wrap gap-1.5">
        {task.labels.map((l) => (
          <LabelChip key={l.id} label={l}>
            {readOnly ? null : (
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove label ${l.name}`}
                onClick={() =>
                  call(() => api(`/tasks/${task.id}/labels/${l.id}`, { method: 'DELETE' }))
                }
                className="ml-1 text-mineral-muted hover:text-red-700 cursor-pointer font-bold"
              >
                ×
              </button>
            )}
          </LabelChip>
        ))}
        {task.labels.length === 0 ? (
          <span className="text-xs text-mineral-muted">No labels assigned.</span>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-xs text-red-600 font-medium">{error}</p> : null}

      {readOnly ? null : (
        <div className="mt-3.5 space-y-2.5 pt-2.5 border-t border-border/70">
          {available.length > 0 ? (
            <label className="block text-xs">
              <span className="sr-only">Add an existing label</span>
              <select
                value=""
                disabled={busy}
                onChange={(e) =>
                  e.target.value &&
                  call(() => api(`/tasks/${task.id}/labels`, { body: { labelId: e.target.value } }))
                }
                className="w-full rounded-lg border border-border bg-subtle/50 px-2.5 py-1.5 text-xs text-graphite hover:bg-white focus:border-accent focus:outline-none cursor-pointer"
              >
                <option value="">+ Add an existing label…</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {creating ? (
            <form
              onSubmit={createAndAttach}
              className="space-y-2.5 rounded-lg border border-border bg-subtle/30 p-2.5"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New label name"
                maxLength={40}
                aria-label="New label name"
                className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-graphite focus:border-accent focus:outline-none"
              />
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Label color">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className={`size-5 rounded-full cursor-pointer transition-transform ${
                      color === c ? 'ring-2 ring-accent ring-offset-1 scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="xs" variant="primary" disabled={busy || !name.trim()}>
                  Create & add
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setCreating(true)}>
              + Create new label
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

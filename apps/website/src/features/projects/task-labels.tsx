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
                className="ml-0.5 text-neutral-400 hover:text-neutral-900"
              >
                ×
              </button>
            )}
          </LabelChip>
        ))}
        {task.labels.length === 0 ? (
          <span className="text-sm text-neutral-500">No labels.</span>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {readOnly ? null : (
        <div className="mt-3 space-y-2">
          {available.length > 0 ? (
            <label className="block text-sm">
              <span className="sr-only">Add a label</span>
              <select
                value=""
                disabled={busy}
                onChange={(e) =>
                  e.target.value &&
                  call(() => api(`/tasks/${task.id}/labels`, { body: { labelId: e.target.value } }))
                }
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Add a label…</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {creating ? (
            <form onSubmit={createAndAttach} className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Label name"
                maxLength={40}
                aria-label="New label name"
                className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
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
                    className={`size-6 rounded-full ${color === c ? 'ring-2 ring-neutral-900 ring-offset-2' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="primary" disabled={busy || !name.trim()}>
                  Create & add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              + New label
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

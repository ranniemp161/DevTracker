'use client';

import type { Label, Task } from '@devtrack/types';
import { createLabelSchema } from '@devtrack/validators';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui';
import { PlusIcon, XIcon } from '@/components/icons';
import { Menu, MenuItem } from '@/components/menu';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { LABEL_COLORS, LabelChip } from './label-chip';
import { useProject } from './project-context';
import { addChip, pickerTrigger } from './property-styles';

/** Labels row on the task page: attach/detach workspace labels, or create one inline. */
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
    <div className="py-1">
      <div className="flex flex-wrap items-center gap-1">
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
                className="touch-target -mr-0.5 inline-flex size-4.5 items-center justify-center rounded-xs text-fg-subtle hover:bg-surface-muted hover:text-fg"
              >
                <XIcon size={12} />
              </button>
            )}
          </LabelChip>
        ))}
        {readOnly ? (
          task.labels.length === 0 ? (
            <span className="px-2 text-sm text-fg-subtle">None</span>
          ) : null
        ) : (
          <Menu
            label="Add a label"
            disabled={busy}
            triggerProps={{ 'aria-label': 'Add a label' }}
            triggerClassName={
              task.labels.length === 0 ? `${pickerTrigger} text-fg-subtle!` : addChip
            }
            menuClassName="w-60"
            trigger={
              task.labels.length === 0 ? (
                <>
                  <PlusIcon size={14} />
                  Add a label
                </>
              ) : (
                <PlusIcon size={14} />
              )
            }
          >
            {available.map((l) => (
              <MenuItem
                key={l.id}
                icon={
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-xs"
                    style={{ backgroundColor: l.color }}
                  />
                }
                onSelect={() =>
                  call(() => api(`/tasks/${task.id}/labels`, { body: { labelId: l.id } }))
                }
              >
                {l.name}
              </MenuItem>
            ))}
            <MenuItem icon={<PlusIcon size={14} />} onSelect={() => setCreating(true)}>
              New label…
            </MenuItem>
          </Menu>
        )}
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      {!readOnly && creating ? (
        <form onSubmit={createAndAttach} className="mt-2 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Label name"
            maxLength={40}
            aria-label="New label name"
            autoFocus
            className="h-8 w-full rounded-control border pointer-coarse:h-11 border-line-control bg-surface px-2.5 text-sm placeholder:text-fg-subtle focus-visible:border-primary"
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
                className={`size-6 rounded-full ${color === c ? 'ring-2 ring-fg ring-offset-2' : ''}`}
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
      ) : null}
    </div>
  );
}

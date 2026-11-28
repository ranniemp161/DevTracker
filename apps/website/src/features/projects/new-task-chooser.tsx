'use client';

import type { Milestone } from '@devtrack/types';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toaster';
import { Field, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate, MILESTONE_STAGE_LABEL, openMilestones } from './labels';
import { useProject } from './project-context';

const QUICK = 'quick';
const NEW_MILESTONE = 'new';

/**
 * New task starts from the delivery (decision record 0030 §2): an open milestone opens its page
 * to add the task there, New milestone creates one and opens its page to write the brief, and
 * No milestone keeps the board's quick add for small chores. Mount it only while open, so each
 * opening starts fresh.
 */
export function NewTaskChooser({
  onQuickTask,
  onClose,
}: {
  onQuickTask: () => void;
  onClose: () => void;
}) {
  const { project } = useProject();
  const router = useRouter();
  const toast = useToast();
  const query = useApiQuery<Milestone[]>(`/projects/${project.id}/milestones`);
  const milestones = openMilestones(query.data ?? []);
  const [selected, setSelected] = useState('');
  const [newName, setNewName] = useState('');
  // Leads and admins manage milestones (0023 §2).
  const canCreate = project.viewerCanManage;
  const base = `/projects/${project.id}/milestones`;

  const ready =
    selected === QUICK ||
    (selected === NEW_MILESTONE && newName.trim().length > 0) ||
    milestones.some((m) => m.id === selected);

  async function createMilestone(name: string) {
    try {
      const { milestone } = await api<{ milestone: Milestone }>(
        `/projects/${project.id}/milestones`,
        { body: { name } },
      );
      router.push(`${base}/${milestone.id}`);
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not create the milestone.');
    }
  }

  function go() {
    onClose();
    if (!ready) return;
    if (selected === QUICK) onQuickTask();
    else if (selected === NEW_MILESTONE) void createMilestone(newName.trim());
    else router.push(`${base}/${selected}?add=1`);
  }

  return (
    <ConfirmDialog
      open
      title="Which delivery is this for?"
      confirmLabel={selected === NEW_MILESTONE ? 'Create milestone' : 'Continue'}
      tone="primary"
      confirmDisabled={!ready}
      onConfirm={go}
      onCancel={onClose}
    >
      <div className="space-y-4">
        <p>
          Tasks are planned inside a milestone: its goal, files and acceptance criteria give the
          team the context.
        </p>
        <Select
          label="Milestone"
          name="new-task-milestone"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!query.data && !query.error}
        >
          <option value="" disabled>
            {query.data || query.error ? 'Choose a milestone' : 'Loading milestones…'}
          </option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {MILESTONE_STAGE_LABEL[m.status]}
              {m.dueDate ? ` · due ${formatDate(m.dueDate)}` : ''}
            </option>
          ))}
          {canCreate ? <option value={NEW_MILESTONE}>New milestone…</option> : null}
          <option value={QUICK}>No milestone (quick task)</option>
        </Select>
        {selected === NEW_MILESTONE ? (
          <Field
            label="Goal"
            name="new-task-milestone-name"
            value={newName}
            maxLength={100}
            placeholder="e.g. v1 Checkout"
            onChange={(e) => setNewName(e.target.value)}
            hint="Starts as Planned. Next you write the brief and add its tasks."
          />
        ) : selected === QUICK ? (
          <p className="text-xs">For small chores that aren&apos;t part of a delivery.</p>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

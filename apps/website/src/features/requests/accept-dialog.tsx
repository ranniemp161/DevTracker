'use client';

import type { Milestone, TaskRequest } from '@devtrack/types';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Field, Select } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate, MILESTONE_STAGE_LABEL, openMilestones } from '../projects/labels';
import { useProject } from '../projects/project-context';

/** What the triager chose: an existing milestone, a new one to create first, or Unscheduled. */
export interface AcceptChoice {
  milestone: { id: string; name: string } | { newName: string } | null;
  assigneeIds: string[];
}

const UNSCHEDULED = 'unscheduled';
const NEW_MILESTONE = 'new';

/**
 * Accept in Triage (decision record 0024 §3): file the task into a milestone or leave it
 * unscheduled, and optionally hand it out. Mount with `key={request.id}` so each request
 * starts from a clean form.
 */
export function AcceptDialog({
  request,
  onAccept,
  onCancel,
}: {
  request: TaskRequest | null;
  onAccept: (request: TaskRequest, choice: AcceptChoice) => void;
  onCancel: () => void;
}) {
  const { project, members } = useProject();
  const query = useApiQuery<Milestone[]>(request ? `/projects/${project.id}/milestones` : null);
  const milestones = openMilestones(query.data ?? []);
  // 0028 §4: changes asked for on a sign-off page start in the milestone they came from.
  const [selected, setSelected] = useState(request?.signoffMilestone?.id ?? '');
  const [newName, setNewName] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  // Leads and admins manage milestones (0023 §2), so they can create one on the spot.
  const canCreate = project.viewerCanManage;

  const ready =
    selected === UNSCHEDULED ||
    (selected === NEW_MILESTONE && newName.trim().length > 0) ||
    milestones.some((m) => m.id === selected);

  function confirm() {
    if (!request || !ready) return;
    const existing = milestones.find((m) => m.id === selected);
    onAccept(request, {
      milestone:
        selected === UNSCHEDULED
          ? null
          : selected === NEW_MILESTONE
            ? { newName: newName.trim() }
            : { id: existing!.id, name: existing!.name },
      assigneeIds,
    });
  }

  function toggleAssignee(id: string, on: boolean) {
    setAssigneeIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));
  }

  return (
    <ConfirmDialog
      open={request !== null}
      title={`Accept ${request?.task?.key ?? 'this request'}?`}
      confirmLabel="Accept"
      tone="primary"
      confirmDisabled={!ready}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      <div className="space-y-4">
        <p>
          Put it into a milestone to commit to it; it moves to To do. Unscheduled keeps it in
          Backlog.
        </p>
        <Select
          label="Milestone"
          name="accept-milestone"
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
          <option value={UNSCHEDULED}>Unscheduled (stays in Backlog)</option>
        </Select>
        {selected === NEW_MILESTONE ? (
          <Field
            label="New milestone name"
            name="accept-milestone-name"
            value={newName}
            maxLength={100}
            onChange={(e) => setNewName(e.target.value)}
            hint="You can add a due date and acceptance criteria on the Milestones page."
          />
        ) : null}
        {members.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-label font-medium text-fg">Assign to (optional)</legend>
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {members.map((m) => (
                <label key={m.user.id} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(m.user.id)}
                    onChange={(e) => toggleAssignee(m.user.id, e.target.checked)}
                  />
                  @{m.user.username}
                  {m.user.jobTitle ? (
                    <span className="text-fg-muted">· {m.user.jobTitle}</span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}

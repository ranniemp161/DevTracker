'use client';

import type { Task } from '@devtrack/types';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useToast } from '@/components/toaster';
import { useProject } from './project-context';

/**
 * 0031 #12: every way of adding a task (the board's quick add, a column's +, Add task on a
 * milestone page) confirms the same way: "Added QA-10" with Open.
 */
export function useTaskAddedToast() {
  const toast = useToast();
  const router = useRouter();
  return useCallback(
    (task: Task, { proposed = false } = {}) =>
      toast.show(`${proposed ? 'Proposed' : 'Added'} ${task.key}`, {
        label: 'Open',
        onClick: () => router.push(`/projects/${task.projectId}/tasks/${task.id}`),
      }),
    [toast, router],
  );
}

/** "Assign to" for a new task: one project member or nobody, shared by every add form. */
export function AssigneeSelect({
  id,
  value,
  onChange,
  className = '',
}: {
  id: string;
  value: string;
  onChange: (userId: string) => void;
  className?: string;
}) {
  const { members } = useProject();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Assign to
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-control border border-line-control bg-surface px-2 text-label text-fg focus-visible:border-primary ${className}`}
      >
        <option value="">Unassigned</option>
        {members.map((member) => (
          <option key={member.user.id} value={member.user.id}>
            @{member.user.username}
          </option>
        ))}
      </select>
    </>
  );
}

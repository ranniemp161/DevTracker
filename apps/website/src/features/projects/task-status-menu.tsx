'use client';

import { TASK_STATUSES, type TaskStatus } from '@devtrack/types';
import { Menu, MenuItem } from '@/components/menu';
import { StatusDot } from '@/components/ui';
import { TASK_STATUS_LABEL } from './labels';

/** Status dot button that opens a menu of statuses; works with keyboard and touch (SPEC R2). */
export function TaskStatusMenu({
  status,
  onSelect,
}: {
  status: TaskStatus;
  onSelect: (status: TaskStatus) => void;
}) {
  return (
    <Menu
      label="Change status"
      align="end"
      triggerProps={{ 'aria-label': `Status: ${TASK_STATUS_LABEL[status]}. Change status` }}
      triggerClassName="touch-target inline-flex size-6.5 items-center justify-center rounded-chip transition-colors hover:bg-surface-muted aria-expanded:bg-surface-muted"
      menuClassName="w-44"
      deferItems
      trigger={<StatusDot status={status} className="size-2.5" />}
    >
      {TASK_STATUSES.map((s) => (
        <MenuItem
          key={s}
          checked={s === status}
          icon={<StatusDot status={s} />}
          onSelect={() => {
            if (s !== status) onSelect(s);
          }}
        >
          {TASK_STATUS_LABEL[s]}
        </MenuItem>
      ))}
    </Menu>
  );
}

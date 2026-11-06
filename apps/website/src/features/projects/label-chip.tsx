import type { TaskLabel } from '@devtrack/types';
import type { ReactNode } from 'react';

export const LABEL_COLORS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#525252',
];

export function LabelChip({ label, children }: { label: TaskLabel; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-xs font-medium whitespace-nowrap text-neutral-700">
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      {label.name}
      {children}
    </span>
  );
}

import type { ChecksState } from '@devtrack/types';
import { AlertIcon, CheckIcon, ClockIcon } from '@/components/icons';

const CHECKS = {
  passing: { label: 'Checks passing', Icon: CheckIcon, tone: 'text-status-done-fg' },
  running: { label: 'Checks running', Icon: ClockIcon, tone: 'text-fg-muted' },
  failing: { label: 'Checks failing', Icon: AlertIcon, tone: 'text-danger' },
} as const;

/** CI state of a pull request (decision record 0015). Never color alone: icon + word. */
export function ChecksBadge({ state, className = '' }: { state: ChecksState; className?: string }) {
  const { label, Icon, tone } = CHECKS[state];
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${tone} ${className}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}

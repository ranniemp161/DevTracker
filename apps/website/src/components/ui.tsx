import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import type { TaskPriority, TaskStatus } from '@devtrack/types';
import { AlertIcon, SpinnerIcon } from './icons';

/** Shared UI primitives for the DevTrack website. Styled with design tokens only (design/SPEC.md §4). */

const inputClass =
  'block h-10 w-full rounded-control border border-line-control bg-surface px-3 text-sm text-fg transition-colors placeholder:text-fg-subtle focus-visible:border-primary aria-invalid:border-danger read-only:border-line read-only:bg-bg read-only:text-fg-muted disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle';

const labelClass = 'block text-label font-medium text-fg';

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) {
    return (
      <p id={`${id}-error`} className="flex items-start gap-1.5 text-xs text-danger">
        <AlertIcon size={14} className="mt-px shrink-0" />
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-hint`} className="text-xs text-fg-muted">
      {hint}
    </p>
  ) : null;
}

export function Field({
  label,
  error,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}) {
  const id = `field-${input.name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
        {...input}
      />
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export function Select({
  label,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; children: ReactNode }) {
  const id = `field-${select.name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} className={inputClass} {...select}>
        {children}
      </select>
    </div>
  );
}

const buttonVariants = {
  primary: 'bg-primary text-fg-on-inverse hover:bg-primary-hover',
  secondary: 'border border-line-control bg-surface text-fg hover:bg-surface-sunken',
  danger: 'border border-danger-line bg-surface text-danger hover:bg-danger-soft',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-muted hover:text-fg',
};

const buttonSizes = {
  sm: 'h-7.5 px-2.5 text-label',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-10 px-4 text-sm',
  xl: 'h-11 px-5 text-sm',
};

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-surface-muted disabled:text-fg-subtle';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  /** Replaces the icon with a spinner and disables the button; the label stays. */
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`${buttonBase} ${buttonSizes[size]} ${buttonVariants[variant]} ${className}`}
      {...props}
    >
      {loading ? <SpinnerIcon size={14} /> : icon}
      {children}
    </button>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" variant="primary" size="xl" loading={pending} className="w-full">
      {pending ? 'Please wait…' : children}
    </Button>
  );
}

const iconButtonSizes = { sm: 'size-6.5', md: 'size-8', lg: 'size-9' };

/** Square ghost button for icon-only actions. `aria-label` is required. */
export function IconButton({
  size = 'md',
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  size?: keyof typeof iconButtonSizes;
}) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:text-fg-subtle ${iconButtonSizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-danger-line bg-status-blocked-bg text-danger',
    success: 'border-status-done-bg bg-status-done-bg text-status-done-fg',
    info: 'border-line bg-surface-sunken text-fg-secondary',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-control border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-fg-subtle">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'green' | 'amber' | 'blue' | 'red';
  children: ReactNode;
}) {
  const styles = {
    neutral: 'bg-status-backlog-bg text-status-backlog-fg',
    green: 'bg-status-done-bg text-status-done-fg',
    amber: 'bg-status-todo-bg text-status-todo-fg',
    blue: 'bg-status-progress-bg text-status-progress-fg',
    red: 'bg-status-blocked-bg text-status-blocked-fg',
  }[tone];
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function Card({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-line bg-surface">
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
          <div>
            <h2 className="text-md font-semibold text-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-label text-fg-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/* ---------- Avatar ---------- */

const avatarSizes = {
  xs: 'size-5 text-2xs',
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-12 text-base',
};

const avatarTones = [
  'bg-avatar-1-bg text-avatar-1-fg',
  'bg-avatar-2-bg text-avatar-2-fg',
  'bg-avatar-3-bg text-avatar-3-fg',
  'bg-avatar-4-bg text-avatar-4-fg',
  'bg-avatar-5-bg text-avatar-5-fg',
];

/** Stable pick of an avatar tone from a seed (user id, falling back to the name). */
export function avatarTone(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarTones[hash % avatarTones.length]!;
}

export function Avatar({
  name,
  url,
  size = 'md',
  seed,
}: {
  name: string;
  url: string | null;
  size?: keyof typeof avatarSizes;
  /** Stable key for the color (pass the user id when you have it). */
  seed?: string;
}) {
  const dim = avatarSizes[size];
  return url ? (
    <img src={url} alt="" className={`${dim} rounded-full`} referrerPolicy="no-referrer" />
  ) : (
    <div
      aria-hidden="true"
      className={`${dim} flex shrink-0 items-center justify-center rounded-full font-semibold uppercase ${avatarTone(seed ?? name)}`}
    >
      {name.slice(0, 1)}
    </div>
  );
}

/** Empty assignee slot: dashed 20px circle. */
export function UnassignedAvatar() {
  return (
    <span
      role="img"
      aria-label="Unassigned"
      className="inline-block size-5 shrink-0 rounded-full border border-dashed border-line-control"
    />
  );
}

/* ---------- Task domain primitives ---------- */

const STATUS_TONE: Record<TaskStatus, { dot: string; pill: string }> = {
  BACKLOG: { dot: 'bg-status-backlog', pill: 'bg-status-backlog-bg text-status-backlog-fg' },
  TODO: { dot: 'bg-status-todo', pill: 'bg-status-todo-bg text-status-todo-fg' },
  IN_PROGRESS: { dot: 'bg-status-progress', pill: 'bg-status-progress-bg text-status-progress-fg' },
  IN_REVIEW: { dot: 'bg-status-review', pill: 'bg-status-review-bg text-status-review-fg' },
  DONE: { dot: 'bg-status-done', pill: 'bg-status-done-bg text-status-done-fg' },
  BLOCKED: { dot: 'bg-status-blocked', pill: 'bg-status-blocked-bg text-status-blocked-fg' },
};

const STATUS_NAME: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  BLOCKED: 'Blocked',
};

export function StatusDot({ status, className = '' }: { status: TaskStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${STATUS_TONE[status].dot} ${className}`}
    />
  );
}

/** Status is always a dot plus a word, never color alone. */
export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_TONE[status].pill}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${STATUS_TONE[status].dot}`} />
      {STATUS_NAME[status]}
    </span>
  );
}

const PRIORITY_BARS: Record<TaskPriority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 3 };
const PRIORITY_NAME: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Three bars plus the priority word. */
export function PriorityIcon({
  priority,
  showLabel = true,
}: {
  priority: TaskPriority;
  showLabel?: boolean;
}) {
  const filled = PRIORITY_BARS[priority];
  const urgent = priority === 'URGENT';
  const bars = [
    { x: 2, y: 9, h: 5 },
    { x: 6.5, y: 6, h: 8 },
    { x: 11, y: 3, h: 11 },
  ];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${urgent ? 'text-danger' : 'text-fg-muted'}`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        {bars.map((bar, i) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width="3"
            height={bar.h}
            rx="1"
            fill={
              i < filled
                ? urgent
                  ? 'var(--dt-priority-urgent)'
                  : 'var(--dt-priority-bar)'
                : 'var(--dt-priority-bar-empty)'
            }
          />
        ))}
      </svg>
      {showLabel ? (
        PRIORITY_NAME[priority]
      ) : (
        <span className="sr-only">{PRIORITY_NAME[priority]}</span>
      )}
    </span>
  );
}

/** Project key badge (`DEV22`). Task keys inside cards stay plain mono text. */
export function KeyBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-chip bg-surface-muted px-2 py-0.5 font-mono text-xs font-medium text-status-backlog-fg">
      {children}
    </span>
  );
}

/* ---------- Controls ---------- */

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-control bg-surface-muted p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-chip px-3 text-xs font-medium transition-colors ${
              selected ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterChip({
  pressed,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`h-7.5 rounded-full border px-3 text-label font-medium whitespace-nowrap transition-colors ${
        pressed
          ? 'border-fg bg-fg text-fg-on-inverse'
          : 'border-line bg-surface text-fg-secondary hover:bg-surface-sunken'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- States ---------- */

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-dashed px-4 py-8 text-center text-label text-fg-subtle">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-card border border-danger-line bg-danger-soft px-4 py-8 text-center text-sm text-danger"
    >
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-control bg-surface-muted ${className}`}
    />
  );
}

/** Titled block inside a side panel (task properties). */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-label font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

/** Two-column settings block: title and description on the left, content on the right. */
export function SettingsSection({
  id,
  title,
  description,
  actions,
  danger = false,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="flex scroll-mt-6 flex-col gap-4 border-b border-line py-7 first:pt-0 last:border-b-0 lg:flex-row lg:gap-10"
    >
      <div className="lg:w-64 lg:shrink-0">
        <h2
          id={id ? `${id}-title` : undefined}
          className={`text-md font-semibold ${danger ? 'text-danger' : 'text-fg'}`}
        >
          {title}
        </h2>
        {description ? <p className="mt-1 text-label text-fg-muted">{description}</p> : null}
        {actions ? <div className="mt-3">{actions}</div> : null}
      </div>
      <div className="min-w-0 flex-1">
        {danger ? (
          <div className="rounded-card border border-danger-line bg-danger-soft p-4.5">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/** Shared UI primitives for the DevTrack website adhering to the redesign design system. */

const inputBaseClass =
  'block w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-graphite transition-colors duration-150 shadow-xs outline-none placeholder:text-mineral-muted focus:border-accent focus:ring-2 focus:ring-accent/15 aria-invalid:border-red-500 disabled:opacity-60 disabled:bg-subtle/50';

export function Field({
  label,
  error,
  hint,
  id: explicitId,
  className = '',
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}) {
  const id = explicitId ?? `field-${input.name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-xs font-medium text-mineral">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputBaseClass}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-mineral-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  children,
  id: explicitId,
  className = '',
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  name: string;
  children: ReactNode;
}) {
  const id = explicitId ?? `field-${select.name}`;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-xs font-medium text-mineral">
        {label}
      </label>
      <select id={id} className={inputBaseClass} {...select}>
        {children}
      </select>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  className = '',
}: {
  pending: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-xs transition-all duration-150 hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none disabled:opacity-60 active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed ${className}`}
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Please wait…
        </span>
      ) : (
        children
      )}
    </button>
  );
}

const buttonVariants = {
  primary:
    'bg-accent text-white shadow-xs hover:bg-accent-hover focus-visible:ring-accent/30 active:scale-[0.98]',
  secondary:
    'border border-border bg-white text-graphite shadow-xs hover:bg-subtle hover:border-border-strong focus-visible:ring-neutral-400 active:scale-[0.98]',
  danger:
    'border border-red-200 bg-white text-red-700 hover:bg-red-50 hover:border-red-300 focus-visible:ring-red-400 active:scale-[0.98]',
  ghost:
    'text-mineral hover:text-graphite hover:bg-subtle focus-visible:ring-neutral-400 active:scale-[0.98]',
  tealGhost:
    'text-accent hover:bg-accent-tint hover:text-accent-hover focus-visible:ring-accent/30 active:scale-[0.98]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: 'xs' | 'sm' | 'md';
}) {
  const sizing =
    size === 'xs'
      ? 'px-2 py-0.5 text-xs rounded-md min-h-[26px]'
      : size === 'sm'
        ? 'px-2.5 py-1 text-xs rounded-lg min-h-[32px]'
        : 'px-3.5 py-2 text-sm rounded-lg min-h-[38px]';

  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${sizing} ${buttonVariants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Alert({
  tone = 'error',
  children,
  className = '',
}: {
  tone?: 'error' | 'success' | 'info' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50/80 text-red-900',
    success: 'border-emerald-200 bg-emerald-50/80 text-emerald-900',
    info: 'border-sky-200 bg-sky-50/80 text-sky-900',
    warning: 'border-amber-200 bg-amber-50/80 text-amber-900',
  }[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed ${styles} ${className}`}
    >
      {children}
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs font-medium text-mineral-muted">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: 'neutral' | 'green' | 'amber' | 'blue' | 'red' | 'teal';
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    neutral: 'bg-subtle text-mineral border-border/80',
    green: 'bg-emerald-50 text-emerald-800 border-emerald-200/80',
    amber: 'bg-amber-50 text-amber-800 border-amber-200/80',
    blue: 'bg-sky-50 text-sky-800 border-sky-200/80',
    red: 'bg-red-50 text-red-800 border-red-200/80',
    teal: 'bg-accent-tint text-accent-text border-accent/20',
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium leading-none ${styles} ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  description,
  children,
  actions,
  className = '',
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(24,38,34,0.04)] ${className}`}
    >
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-graphite tracking-tight">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-mineral">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Avatar({
  name,
  url,
  size = 'md',
}: {
  name: string;
  url: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) {
  const dim = {
    xs: 'size-5 text-[10px]',
    sm: 'size-7 text-xs',
    md: 'size-8 text-xs',
    lg: 'size-11 text-sm',
  }[size];

  return url ? (
    <img
      src={url}
      alt={name}
      className={`${dim} rounded-full object-cover ring-1 ring-border`}
      referrerPolicy="no-referrer"
    />
  ) : (
    <div
      aria-label={name}
      className={`${dim} flex items-center justify-center rounded-full bg-subtle font-semibold uppercase text-mineral ring-1 ring-border`}
    >
      {name.slice(0, 1)}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-subtle ${className}`} />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/60 p-8 text-center sm:p-12">
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-mineral">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-semibold text-graphite">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs text-mineral">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 text-center sm:p-6">
      <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-red-100 text-red-700">
        <svg aria-hidden="true" className="size-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-red-900">{message}</p>
      {onRetry ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={onRetry}
          className="mt-3 border-red-200 text-red-800 hover:bg-red-100/50"
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}

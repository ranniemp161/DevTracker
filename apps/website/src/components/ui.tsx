import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

/** Shared UI primitives for the DevTrack website. */

const inputClass =
  'block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-xs outline-none placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 aria-invalid:border-red-500';

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
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
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
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {label}
      </label>
      <select id={id} className={inputClass} {...select}>
        {children}
      </select>
    </div>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900/30 focus-visible:outline-none disabled:opacity-60"
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}

const buttonVariants = {
  primary: 'bg-neutral-900 text-white hover:bg-neutral-800',
  secondary: 'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  ghost: 'text-neutral-700 hover:bg-neutral-100',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: 'sm' | 'md';
}) {
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium focus-visible:ring-2 focus-visible:ring-neutral-900/30 focus-visible:outline-none disabled:opacity-60 ${sizing} ${buttonVariants[variant]} ${className}`}
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
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    info: 'border-neutral-200 bg-neutral-50 text-neutral-700',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-neutral-500">
      <span className="h-px flex-1 bg-neutral-200" />
      {label}
      <span className="h-px flex-1 bg-neutral-200" />
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
    neutral: 'bg-neutral-100 text-neutral-700',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-800',
    red: 'bg-red-100 text-red-800',
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
    <section className="rounded-xl border border-neutral-200 bg-white">
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-neutral-600">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
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
  size?: 'sm' | 'md' | 'lg';
}) {
  const dim = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' }[size];
  return url ? (
    <img src={url} alt="" className={`${dim} rounded-full`} referrerPolicy="no-referrer" />
  ) : (
    <div
      className={`${dim} flex items-center justify-center rounded-full bg-neutral-200 font-semibold uppercase`}
    >
      {name.slice(0, 1)}
    </div>
  );
}

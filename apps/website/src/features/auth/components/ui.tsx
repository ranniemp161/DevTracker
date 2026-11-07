import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 text-center group">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-white font-bold text-xs tracking-wider shadow-xs group-hover:bg-accent-hover transition-colors">
            DT
          </div>
          <span className="text-xl font-bold tracking-tight text-graphite">DevTrack</span>
        </Link>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-xs">
          <h1 className="text-xl font-semibold tracking-tight text-graphite">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-xs text-mineral leading-relaxed">{subtitle}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? (
          <div className="mt-6 text-center text-xs text-mineral leading-relaxed">{footer}</div>
        ) : null}
      </div>
    </main>
  );
}

export { Alert, Divider, Field, SubmitButton } from '@/components/ui';

/** A plain link (not next/link): the API answers with a redirect to GitHub. */
export function GithubButton({ redirectTo }: { redirectTo: string }) {
  return (
    <a
      href={`/api/v1/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs font-semibold text-graphite shadow-xs transition-all hover:bg-subtle hover:border-border-strong active:scale-[0.98] cursor-pointer"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      Continue with GitHub
    </a>
  );
}

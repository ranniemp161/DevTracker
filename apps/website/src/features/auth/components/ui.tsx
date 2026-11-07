import Link from 'next/link';
import type { ReactNode } from 'react';
import { CheckIcon, DevtrackMark } from '@/components/icons';

const BRAND_POINTS = [
  'Tasks that follow your branches and pull requests.',
  'One board for the whole team, always up to date.',
  'Chat in the project, right next to the work.',
];

/** Split-screen auth layout: brand panel on the left (a logo bar on phones), form on the right. */
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
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex flex-col justify-between bg-surface-inverse px-6 py-4 text-fg-on-inverse lg:w-110 lg:shrink-0 lg:px-14 lg:py-12">
        <Link href="/" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          <DevtrackMark size={32} tone="mint" />
          DevTrack
        </Link>
        <div className="hidden space-y-8 lg:block">
          <p className="text-hero leading-tight font-semibold tracking-tight">
            Your tasks, your repos, your team. One board.
          </p>
          <ul className="space-y-4">
            {BRAND_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm text-fg-on-inverse-muted">
                <CheckIcon size={16} className="mt-0.5 shrink-0 text-mint" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-xs text-fg-on-inverse-muted lg:block">© 2026 DevTrack</p>
      </aside>
      <main className="flex flex-1 items-center justify-center bg-surface px-4 py-10 sm:px-8">
        <div className="w-full max-w-95">
          <h1 className="text-title font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p> : null}
          <div className="mt-7">{children}</div>
          {footer ? <div className="mt-6 text-center text-sm text-fg-muted">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}

export { Alert, Divider, Field, SubmitButton } from '@/components/ui';

/** A plain link (not next/link): the API answers with a redirect to GitHub. */
export function GithubButton({ redirectTo }: { redirectTo: string }) {
  return (
    <a
      href={`/api/v1/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-control border border-line-control bg-surface px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-sunken"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
      Continue with GitHub
    </a>
  );
}

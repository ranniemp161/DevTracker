'use client';

import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Crumb {
  label: ReactNode;
  href?: string;
  /** Extra classes, e.g. to show a crumb only on small screens. */
  className?: string;
  /** Classes for the "/" before this crumb, e.g. to hide it when the crumb before is hidden. */
  separatorClassName?: string;
}

const ActionsSlot = createContext<HTMLElement | null>(null);

/**
 * Page header from design/SPEC.md §5: breadcrumb, title with optional meta (badges),
 * and the page's actions on the right. Layouts render the header; the page below it
 * puts its own actions there with <HeaderActions>.
 */
export function PageHeader({
  breadcrumb,
  title,
  meta,
  className = '',
  children,
}: {
  className?: string;
  breadcrumb?: Crumb[];
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <ActionsSlot.Provider value={slot}>
      <header
        className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4 ${className}`}
      >
        <div className="min-w-0">
          {breadcrumb?.length ? (
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1.5 text-label text-fg-muted">
                {breadcrumb.map((crumb, i) => (
                  <li key={i} className={`flex items-center gap-1.5 ${crumb.className ?? ''}`}>
                    {i > 0 ? (
                      <span aria-hidden="true" className={crumb.separatorClassName}>
                        /
                      </span>
                    ) : null}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="rounded-chip hover:text-fg hover:underline"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      crumb.label
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="min-w-0 text-title font-semibold tracking-tight text-balance text-fg">
              {title}
            </h1>
            {meta}
          </div>
        </div>
        <div ref={setSlot} className="flex flex-wrap items-center gap-3 empty:hidden" />
      </header>
      {children}
    </ActionsSlot.Provider>
  );
}

/** Renders the page's primary actions in the nearest PageHeader. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

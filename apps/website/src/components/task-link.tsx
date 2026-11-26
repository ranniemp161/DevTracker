'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';

/**
 * A link to a task page that prefetches only once the user shows intent (hover, focus or
 * touch). Task pages are static shells (#127), so a plain `<Link>` would prefetch every task
 * in view, which on a board of hundreds of cards means hundreds of requests and server
 * renders no one asked for. Navigation links elsewhere keep Next's default prefetching.
 */
export function TaskLink({
  onPointerEnter,
  onFocus,
  onTouchStart,
  ...props
}: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onPointerEnter={(e) => {
        setIntent(true);
        onPointerEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}

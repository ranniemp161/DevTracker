import type { Metadata } from 'next';
import { Suspense } from 'react';
import { MilestonePage } from '@/features/projects/milestone-page';

export const metadata: Metadata = { title: 'Milestone' };

/** Same as the `[id]` layouts: rendered once per milestone on first visit, then prefetched (#127). */
export function generateStaticParams(): { milestoneId: string }[] {
  return [];
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-fg-subtle">Loading milestone…</p>}>
      <MilestonePage />
    </Suspense>
  );
}

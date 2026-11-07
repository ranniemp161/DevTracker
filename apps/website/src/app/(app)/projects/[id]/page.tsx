import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Board } from '@/features/projects/board';

export const metadata: Metadata = { title: 'Board' };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-fg-subtle">Loading board…</p>}>
      <Board />
    </Suspense>
  );
}

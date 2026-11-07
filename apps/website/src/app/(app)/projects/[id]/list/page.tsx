import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TaskList } from '@/features/projects/task-list';

export const metadata: Metadata = { title: 'Tasks' };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-fg-subtle">Loading tasks…</p>}>
      <TaskList />
    </Suspense>
  );
}

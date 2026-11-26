import type { Metadata } from 'next';
import { TaskDetail } from '@/features/projects/task-detail';

export const metadata: Metadata = { title: 'Task' };

/** Same as the `[id]` layouts: rendered once per task on first visit, then prefetched (#127). */
export function generateStaticParams(): { taskId: string }[] {
  return [];
}

export default function Page() {
  return <TaskDetail />;
}

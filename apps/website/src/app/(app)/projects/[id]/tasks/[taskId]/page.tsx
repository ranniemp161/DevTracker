import type { Metadata } from 'next';
import { TaskDetail } from '@/features/projects/task-detail';

export const metadata: Metadata = { title: 'Task' };

export default function Page() {
  return <TaskDetail />;
}

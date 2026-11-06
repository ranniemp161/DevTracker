import type { Metadata } from 'next';
import { TaskList } from '@/features/projects/task-list';

export const metadata: Metadata = { title: 'Tasks' };

export default function Page() {
  return <TaskList />;
}

import type { Metadata } from 'next';
import { MyTasksPage } from '@/features/projects/my-tasks-page';

export const metadata: Metadata = { title: 'My tasks' };

export default function Page() {
  return <MyTasksPage />;
}

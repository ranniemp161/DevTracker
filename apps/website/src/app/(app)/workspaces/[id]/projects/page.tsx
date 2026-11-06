import type { Metadata } from 'next';
import { ProjectList } from '@/features/projects/project-list';

export const metadata: Metadata = { title: 'Projects' };

export default function Page() {
  return <ProjectList />;
}

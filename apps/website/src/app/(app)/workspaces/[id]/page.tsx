import type { Metadata } from 'next';
import { ProjectList } from '@/features/projects/project-list';

export const metadata: Metadata = { title: 'Projects' };

/** A workspace opens on its projects (design/SPEC.md §5). */
export default function WorkspacePage() {
  return <ProjectList />;
}

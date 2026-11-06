import type { ReactNode } from 'react';
import { ProjectLayout } from '@/features/projects/project-context';

export default function Layout({ children }: { children: ReactNode }) {
  return <ProjectLayout>{children}</ProjectLayout>;
}

import type { Metadata } from 'next';
import { CreateProjectForm } from '@/features/projects/create-project-form';

export const metadata: Metadata = { title: 'New project' };

export default function Page() {
  return <CreateProjectForm />;
}

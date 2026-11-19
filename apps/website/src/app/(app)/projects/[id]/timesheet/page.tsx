import type { Metadata } from 'next';
import { ProjectTimesheet } from '@/features/projects/project-timesheet';

export const metadata: Metadata = { title: 'Timesheet' };

export default function Page() {
  return <ProjectTimesheet />;
}

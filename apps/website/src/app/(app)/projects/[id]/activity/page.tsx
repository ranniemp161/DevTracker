import type { Metadata } from 'next';
import { ProjectActivity } from '@/features/collaboration/project-activity';

export const metadata: Metadata = { title: 'Activity' };

export default function Page() {
  return <ProjectActivity />;
}

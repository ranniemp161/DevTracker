import type { Metadata } from 'next';
import { ProjectMembers } from '@/features/projects/project-members';

export const metadata: Metadata = { title: 'Project members' };

export default function Page() {
  return <ProjectMembers />;
}

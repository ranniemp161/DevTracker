import type { Metadata } from 'next';
import { WorkspacesHome } from '@/features/workspaces/workspaces-home';

export const metadata: Metadata = { title: 'Workspaces' };

export default function HomePage() {
  return <WorkspacesHome />;
}

import type { Metadata } from 'next';
import { WorkspaceOverviewPage } from '@/features/projects/workspace-overview-page';

export const metadata: Metadata = { title: 'Overview' };

export default function Page() {
  return <WorkspaceOverviewPage />;
}

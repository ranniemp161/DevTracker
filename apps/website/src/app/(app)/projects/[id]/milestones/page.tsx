import type { Metadata } from 'next';
import { MilestonesPage } from '@/features/projects/milestones-page';

export const metadata: Metadata = { title: 'Milestones' };

export default function Page() {
  return <MilestonesPage />;
}

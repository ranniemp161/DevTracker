import type { Metadata } from 'next';
import { MembersPage } from '@/features/workspaces/members-page';

export const metadata: Metadata = { title: 'Members' };

export default function Page() {
  return <MembersPage />;
}

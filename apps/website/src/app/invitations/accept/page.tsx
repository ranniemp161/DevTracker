import type { Metadata } from 'next';
import { AcceptInvitation } from '@/features/invitations/accept-invitation';

export const metadata: Metadata = { title: 'Join a workspace', referrer: 'no-referrer' };

export default function AcceptInvitationPage() {
  return <AcceptInvitation />;
}

import type { Metadata } from 'next';
import { StopClientEmails } from '@/features/requests/stop-client-emails';

export const metadata: Metadata = {
  title: 'Stop emails',
  robots: { index: false, follow: false },
};

export default function StopEmailsPage() {
  return <StopClientEmails />;
}

import type { Metadata } from 'next';
import { PublicRequestForm } from '@/features/requests/public-request-form';

export const metadata: Metadata = {
  title: 'Send a request',
  // Each link is private to whoever it was shared with.
  robots: { index: false, follow: false },
};

export default function PublicRequestPage() {
  return <PublicRequestForm />;
}

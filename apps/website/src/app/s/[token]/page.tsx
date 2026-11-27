import type { Metadata } from 'next';
import { ClientSignoff } from '@/features/requests/client-signoff';

export const metadata: Metadata = {
  title: 'Review a delivery',
  // Each link is private to the client it was shared with.
  robots: { index: false, follow: false },
};

export default function ClientSignoffPage() {
  return <ClientSignoff />;
}

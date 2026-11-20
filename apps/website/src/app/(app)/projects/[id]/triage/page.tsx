import type { Metadata } from 'next';
import { TriagePage } from '@/features/requests/triage-page';

export const metadata: Metadata = { title: 'Triage' };

export default function Page() {
  return <TriagePage />;
}

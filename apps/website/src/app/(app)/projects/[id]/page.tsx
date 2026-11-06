import type { Metadata } from 'next';
import { Board } from '@/features/projects/board';

export const metadata: Metadata = { title: 'Board' };

export default function Page() {
  return <Board />;
}

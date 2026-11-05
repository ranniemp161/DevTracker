import type { ReactNode } from 'react';
import { AppShell } from '@/features/session/app-shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

import type { ReactNode } from 'react';
import { WorkspaceLayout } from '@/features/workspaces/workspace-context';

export default function Layout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}

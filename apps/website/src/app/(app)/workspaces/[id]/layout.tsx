import type { ReactNode } from 'react';
import { WorkspaceLayout } from '@/features/workspaces/workspace-context';

/**
 * Every page under this segment loads its data in the browser, so the server output is the
 * same for every id. Rendering it once per id on first visit and caching it (no paths at
 * build time) makes the routes static, so links prefetch them in full and a click starts
 * the page's API calls without waiting on the server (#127).
 */
export function generateStaticParams(): { id: string }[] {
  return [];
}

export default function Layout({ children }: { children: ReactNode }) {
  return <WorkspaceLayout>{children}</WorkspaceLayout>;
}

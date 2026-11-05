import type { Metadata } from 'next';
import { CreateWorkspaceForm } from '@/features/workspaces/create-workspace-form';

export const metadata: Metadata = { title: 'New workspace' };

export default function NewWorkspacePage() {
  return <CreateWorkspaceForm />;
}

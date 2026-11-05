import type { Metadata } from 'next';
import { SettingsPage } from '@/features/workspaces/settings-page';

export const metadata: Metadata = { title: 'Workspace settings' };

export default function Page() {
  return <SettingsPage />;
}

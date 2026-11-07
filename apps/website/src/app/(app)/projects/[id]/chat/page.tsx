import type { Metadata } from 'next';
import { ChatView } from '@/features/chat/chat-view';

export const metadata: Metadata = { title: 'Project Chat' };

export default function Page() {
  return <ChatView />;
}

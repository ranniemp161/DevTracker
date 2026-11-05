'use client';

import type { PublicUser, WorkspaceSummary } from '@devtrack/types';
import { createContext, useContext } from 'react';

export interface Session {
  user: PublicUser;
  workspaces: WorkspaceSummary[];
  reloadWorkspaces: () => void;
}

export const SessionContext = createContext<Session | null>(null);

/** The signed-in user and their workspaces. Only valid inside the (app) layout. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside AppShell');
  return session;
}

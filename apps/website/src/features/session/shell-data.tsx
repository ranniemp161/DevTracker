'use client';

import { createContext, useContext } from 'react';

/** Lets pages inside the shell refresh data the sidebar shows (e.g. chat unread counts). */
export const ShellDataContext = createContext<{ reloadChatUnread: () => void }>({
  reloadChatUnread: () => undefined,
});

export const useShellData = () => useContext(ShellDataContext);

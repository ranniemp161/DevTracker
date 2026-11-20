/** Remembers the workspace a user last opened, so `/` can take them straight back to it. */
const KEY = 'devtrack_last_workspace';

/** Query flag on `/` that shows the workspace picker instead of redirecting. */
export const CHOOSE_WORKSPACE_PARAM = 'choose';

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberLastWorkspace(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Storage can be blocked (private mode); the picker still works.
  }
}

export function forgetLastWorkspace() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Where `/` should send the user: their only workspace, else the last one they opened. */
export function pickHomeWorkspace(workspaceIds: string[], lastId: string | null): string | null {
  if (workspaceIds.length === 1) return workspaceIds[0]!;
  return lastId && workspaceIds.includes(lastId) ? lastId : null;
}

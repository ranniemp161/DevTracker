import type { WorkspaceRole } from '@devtrack/types';

/**
 * UI hints only — decide which controls to show. The API enforces the real rules
 * (apps/api/src/workspaces/workspace-policy.ts); keep these in step with it.
 */
export const isAdmin = (role: WorkspaceRole) => role === 'OWNER' || role === 'ADMIN';

export function canManageMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (target === 'OWNER') return false;
  if (actor === 'OWNER') return true;
  return actor === 'ADMIN' && target === 'MEMBER';
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
};

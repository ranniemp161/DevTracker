import type { WorkspaceRole } from '@devtrack/types';
const RANK: Record<WorkspaceRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function hasAtLeastRole(actual: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return RANK[actual] >= RANK[minimum];
}

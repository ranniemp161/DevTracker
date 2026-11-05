import type { AssignableWorkspaceRole, WorkspaceRole } from '@devtrack/types';

/**
 * Workspace role rules (architecture §6 + approved M2 rules 2–3). Pure functions so the full
 * permission matrix is unit-testable; services call these and translate denials into errors.
 */

const RANK: Record<WorkspaceRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function hasAtLeastRole(actual: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return RANK[actual] >= RANK[minimum];
}

export function compareRoles(a: WorkspaceRole, b: WorkspaceRole): number {
  return RANK[b] - RANK[a];
}

export type PolicyDecision =
  { allowed: true } | { allowed: false; reason: 'OWNER_PROTECTED' | 'FORBIDDEN' };

const ALLOW: PolicyDecision = { allowed: true };
const FORBIDDEN: PolicyDecision = { allowed: false, reason: 'FORBIDDEN' };
const OWNER_PROTECTED: PolicyDecision = { allowed: false, reason: 'OWNER_PROTECTED' };

export interface MemberRef {
  userId: string;
  role: WorkspaceRole;
}

/** Owners and Admins may invite, as Admin or Member. Nobody can invite an Owner. */
export function canInvite(
  actorRole: WorkspaceRole,
  _role: AssignableWorkspaceRole,
): PolicyDecision {
  return hasAtLeastRole(actorRole, 'ADMIN') ? ALLOW : FORBIDDEN;
}

/**
 * - The Owner's role can never change (no demotion, no transfer in M2).
 * - Owners may set any other member to Admin or Member.
 * - Admins may change Members only (promote to Admin or keep Member); not other Admins or themselves.
 * - Members may not change roles.
 */
export function canChangeRole(actor: MemberRef, target: MemberRef): PolicyDecision {
  if (target.role === 'OWNER') return OWNER_PROTECTED;
  if (actor.role === 'OWNER') return ALLOW;
  if (actor.role === 'ADMIN' && target.role === 'MEMBER') return ALLOW;
  return FORBIDDEN;
}

/**
 * - The Owner can never be removed and cannot leave.
 * - Anyone else may leave (remove themselves).
 * - Owners may remove anyone else; Admins may remove Members only.
 */
export function canRemoveMember(actor: MemberRef, target: MemberRef): PolicyDecision {
  if (target.role === 'OWNER') return OWNER_PROTECTED;
  if (actor.userId === target.userId) return ALLOW;
  if (actor.role === 'OWNER') return ALLOW;
  if (actor.role === 'ADMIN' && target.role === 'MEMBER') return ALLOW;
  return FORBIDDEN;
}

/** Architecture §6 — workspace roles. */
export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];

/** Roles that can be granted by invitation or role change (never OWNER). */
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, 'OWNER'>;

/** A workspace as seen by one of its members. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  /** The requesting user's role in this workspace. */
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceDetails extends WorkspaceSummary {
  ownerId: string;
  memberCount: number;
  updatedAt: string;
}

export interface WorkspaceMemberUser {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
}

export interface WorkspaceMember {
  user: WorkspaceMemberUser;
  role: WorkspaceRole;
  joinedAt: string;
}

export type InvitationStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: AssignableWorkspaceRole;
  status: InvitationStatus;
  invitedBy: { id: string; username: string } | null;
  expiresAt: string;
  createdAt: string;
}

/** What an invitee sees after accepting. */
export interface AcceptInvitationResult {
  workspace: WorkspaceSummary;
}

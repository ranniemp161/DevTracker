import {
  and,
  eq,
  gt,
  isNull,
  workspaceMembers,
  workspaces,
  projectMembers,
  projects,
  sessions,
  sql,
  users,
  type Executor,
} from '@devtrack/database';
import { isUuid } from './uuid.js';
import { hasAtLeastRole } from './roles.js';

/** Shared visibility queries. A denial and a missing resource both return null. */
export async function findWorkspaceAccess(executor: Executor, userId: string, workspaceId: string) {
  if (!isUuid(workspaceId)) return null;
  const [row] = await executor
    .select({ workspace: workspaces, membership: workspaceMembers })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.archivedAt)))
    .limit(1);

  return row ?? null;
}

/** True when the outer query's project has at least one lead (0023 §4). */
export const projectHasLeads = sql<boolean>`exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.role} = 'lead')`;

export async function findProjectAccess(executor: Executor, userId: string, projectId: string) {
  if (!isUuid(projectId)) return null;
  const [row] = await executor
    .select({
      project: projects,
      workspaceRole: workspaceMembers.role,
      projectMembershipId: projectMembers.id,
      projectRole: projectMembers.role,
      hasLeads: projectHasLeads,
    })
    .from(projects)
    .innerJoin(
      workspaces,
      and(eq(workspaces.id, projects.workspaceId), isNull(workspaces.archivedAt)),
    )
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
    )
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!row) return null;
  const isWorkspaceAdmin = hasAtLeastRole(row.workspaceRole, 'ADMIN');
  if (!isWorkspaceAdmin && !row.projectMembershipId) return null;
  // Decision record 0023 §2: a lead manages their own project, never others.
  const canManage = isWorkspaceAdmin || row.projectRole === 'lead';
  // 0023 §4: everyone triages until the project has a lead; then leads and admins do.
  const canTriage = canManage || !row.hasLeads;
  return {
    project: row.project,
    workspaceRole: row.workspaceRole,
    canManage,
    isWorkspaceAdmin,
    canTriage,
  };
}

export async function findActiveSession(executor: Executor, sessionId: string) {
  if (!isUuid(sessionId)) return null;
  const [row] = await executor
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

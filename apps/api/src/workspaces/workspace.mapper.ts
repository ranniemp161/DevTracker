import { hasAtLeastRole } from '@devtrack/server-core';
import type { WorkspaceDetails, WorkspaceRole, WorkspaceSummary } from '@devtrack/types';
import type { Workspace } from './workspace-access.service';

/** `leadsProjects`: the viewer leads at least one unarchived project here (0027 §2). */
export function toWorkspaceSummary(
  workspace: Workspace,
  role: WorkspaceRole,
  leadsProjects = false,
): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role,
    viewerCanSeeOverview: hasAtLeastRole(role, 'ADMIN') || leadsProjects,
    createdAt: workspace.createdAt.toISOString(),
  };
}

export function toWorkspaceDetails(
  workspace: Workspace,
  role: WorkspaceRole,
  memberCount: number,
  leadsProjects = false,
): WorkspaceDetails {
  return {
    ...toWorkspaceSummary(workspace, role, leadsProjects),
    ownerId: workspace.ownerId,
    memberCount,
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

import type { WorkspaceDetails, WorkspaceRole, WorkspaceSummary } from '@devtrack/types';
import type { Workspace } from './workspace-access.service';

export function toWorkspaceSummary(workspace: Workspace, role: WorkspaceRole): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    role,
    createdAt: workspace.createdAt.toISOString(),
  };
}

export function toWorkspaceDetails(
  workspace: Workspace,
  role: WorkspaceRole,
  memberCount: number,
): WorkspaceDetails {
  return {
    ...toWorkspaceSummary(workspace, role),
    ownerId: workspace.ownerId,
    memberCount,
    updatedAt: workspace.updatedAt.toISOString(),
  };
}

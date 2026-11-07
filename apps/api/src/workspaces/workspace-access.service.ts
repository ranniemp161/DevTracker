import { Inject, Injectable } from '@nestjs/common';
import { workspaceMembers, workspaces, type Database, type Executor } from '@devtrack/database';
import type { WorkspaceRole } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { findWorkspaceAccess } from '@devtrack/server-core';
import { DATABASE } from '../database/database.module';
import { hasAtLeastRole } from './workspace-policy';

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMembership = typeof workspaceMembers.$inferSelect;

export interface WorkspaceAccess {
  workspace: Workspace;
  membership: WorkspaceMembership;
}

/**
 * The single entry point for workspace authorization (architecture §6). Every module that
 * touches workspace-scoped data must resolve access through here.
 *
 * - Non-members, archived workspaces and nonexistent IDs all produce the same 404, so a
 *   guessed UUID reveals nothing (approved M2 rule 6).
 * - Members without the required role get 403.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async require(
    userId: string,
    workspaceId: string,
    minimumRole: WorkspaceRole = 'MEMBER',
    executor: Executor = this.db,
  ): Promise<WorkspaceAccess> {
    const row = await findWorkspaceAccess(executor, userId, workspaceId);

    if (!row) throw notFound();
    if (!hasAtLeastRole(row.membership.role, minimumRole)) {
      throw AppException.forbidden(
        minimumRole === 'OWNER'
          ? 'Only the workspace owner can do this.'
          : 'You need to be a workspace admin to do this.',
      );
    }
    return row;
  }
}

const notFound = () => AppException.notFound('Workspace not found.');

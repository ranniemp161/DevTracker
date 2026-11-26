import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  or,
  projectMembers,
  projects,
  users,
  workspaceMembers,
  type Database,
  type Executor,
} from '@devtrack/database';
import { ErrorCode, type WorkspaceRole } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { findProjectAccess } from '@devtrack/server-core';
import { DATABASE } from '../database/database.module';

export type ProjectRow = typeof projects.$inferSelect;

export interface ProjectAccess {
  project: ProjectRow;
  workspaceRole: WorkspaceRole;
  /** Workspace Owner/Admin or a lead of this project: may change the project (0023 §2). */
  canManage: boolean;
  /** Workspace Owner/Admin: sees every project; archives it and manages its people. */
  isWorkspaceAdmin: boolean;
  /** Everyone with access until the project has a lead; then leads and admins (0023 §4). */
  canTriage: boolean;
  /** Internal triage is on and the project has a lead (0023 §3). */
  internalTriageInEffect: boolean;
  /** Internal triage is in effect and the user isn't a lead or admin: they propose tasks. */
  mustPropose: boolean;
}

export interface ProjectAccessOptions {
  /** Requires a workspace Owner/Admin or a lead of the project (403 otherwise). */
  manage?: boolean;
  /** Requires a workspace Owner/Admin (403 otherwise), even for project leads. */
  admin?: boolean;
  /** Requires `canTriage` (403 otherwise). */
  triage?: boolean;
  /** Rejects archived projects with 409 PROJECT_ARCHIVED (archived = read-only). */
  write?: boolean;
}

/**
 * Single entry point for project authorization (architecture §6, approved M3 rule 1):
 * - the user must belong to the project's (non-archived) workspace;
 * - workspace Owners/Admins can access every project;
 * - Members can access only projects they were added to.
 * Everyone else gets the same 404 as for a nonexistent project.
 */
@Injectable()
export class ProjectAccessService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async require(
    userId: string,
    projectId: string,
    options: ProjectAccessOptions = {},
    executor: Executor = this.db,
  ): Promise<ProjectAccess> {
    const row = await findProjectAccess(executor, userId, projectId);

    if (!row) throw notFound();
    const { canManage, isWorkspaceAdmin, canTriage, internalTriageInEffect, mustPropose } = row;
    if (options.admin && !isWorkspaceAdmin) {
      throw AppException.forbidden('You need to be a workspace admin to do this.');
    }
    if (options.manage && !canManage) {
      throw AppException.forbidden('You need to be a project lead or workspace admin to do this.');
    }
    if (options.triage && !canTriage) {
      throw AppException.forbidden('Only the project leads triage requests in this project.');
    }
    if (
      (options.write || options.manage || options.admin || options.triage) &&
      row.project.status === 'ARCHIVED'
    ) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PROJECT_ARCHIVED,
        'This project is archived and read-only.',
      );
    }
    return {
      project: row.project,
      workspaceRole: row.workspaceRole,
      canManage,
      isWorkspaceAdmin,
      canTriage,
      internalTriageInEffect,
      mustPropose,
    };
  }

  /**
   * Everyone who can access the project: its members plus the workspace's Owner/Admins.
   * Optionally narrowed to the given usernames (for `@mentions`, M4 rule 2).
   */
  async audience(
    project: Pick<ProjectRow, 'id' | 'workspaceId'>,
    options: { usernames?: string[] } = {},
    executor: Executor = this.db,
  ): Promise<{ id: string; username: string }[]> {
    if (options.usernames && options.usernames.length === 0) return [];
    const projectMemberIds = executor
      .select({ id: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, project.id));
    const adminIds = executor
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, project.workspaceId),
          inArray(workspaceMembers.role, ['OWNER', 'ADMIN']),
        ),
      );
    return executor
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(
        and(
          or(inArray(users.id, projectMemberIds), inArray(users.id, adminIds)),
          options.usernames ? inArray(users.username, options.usernames) : undefined,
        ),
      );
  }
}

const notFound = () => AppException.notFound('Project not found.');

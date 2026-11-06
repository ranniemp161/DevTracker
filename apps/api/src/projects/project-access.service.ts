import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
  type Database,
  type Executor,
} from '@devtrack/database';
import { ErrorCode, type WorkspaceRole } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { hasAtLeastRole } from '../workspaces/workspace-policy';

export type ProjectRow = typeof projects.$inferSelect;

export interface ProjectAccess {
  project: ProjectRow;
  workspaceRole: WorkspaceRole;
  /** Workspace Owner/Admin: sees every project, may edit, archive and manage members. */
  canManage: boolean;
}

export interface ProjectAccessOptions {
  /** Requires workspace Owner/Admin (403 otherwise). */
  manage?: boolean;
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
    if (!isUuid(projectId)) throw notFound();

    const [row] = await executor
      .select({
        project: projects,
        workspaceRole: workspaceMembers.role,
        projectMembershipId: projectMembers.id,
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

    if (!row) throw notFound();
    const canManage = hasAtLeastRole(row.workspaceRole, 'ADMIN');
    if (!canManage && !row.projectMembershipId) throw notFound();
    if (options.manage && !canManage) {
      throw AppException.forbidden('You need to be a workspace admin to manage this project.');
    }
    if ((options.write || options.manage) && row.project.status === 'ARCHIVED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PROJECT_ARCHIVED,
        'This project is archived and read-only.',
      );
    }
    return { project: row.project, workspaceRole: row.workspaceRole, canManage };
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

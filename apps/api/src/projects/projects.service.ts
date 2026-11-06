import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  inArray,
  ne,
  projectMembers,
  projects,
  sql,
  taskAssignees,
  tasks,
  users,
  workspaceMembers,
  type Database,
  type SQL,
} from '@devtrack/database';
import { ErrorCode, type Project, type ProjectMember } from '@devtrack/types';
import type { CreateProjectInput, UpdateProjectInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { hasAtLeastRole } from '../workspaces/workspace-policy';
import { ProjectAccessService, type ProjectRow } from './project-access.service';

const memberCount = sql<number>`(select count(*)::int from ${projectMembers} where ${projectMembers.projectId} = ${projects.id})`;
const creatorColumns = { id: users.id, username: users.username, avatarUrl: users.avatarUrl };

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly access: ProjectAccessService,
  ) {}

  /** Admins and the Owner create projects; the creator becomes a project member. */
  async create(userId: string, workspaceId: string, input: CreateProjectInput): Promise<Project> {
    await this.workspaceAccess.require(userId, workspaceId, 'ADMIN');
    let created: ProjectRow;
    try {
      created = await this.db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({
            workspaceId,
            name: input.name,
            key: input.key,
            description: input.description ?? null,
            status: input.status ?? 'PLANNING',
            startDate: input.startDate ?? null,
            targetDate: input.targetDate ?? null,
            createdBy: userId,
          })
          .returning();
        await tx.insert(projectMembers).values({ projectId: project!.id, userId });
        return project!;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'projects_workspace_key_unique')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PROJECT_KEY_TAKEN,
          `The key ${input.key} is already used by another project in this workspace.`,
        );
      }
      throw err;
    }
    return this.load(created.id, true);
  }

  /** Admins see every project; Members see the projects they belong to (M3 rule 1). */
  async list(userId: string, workspaceId: string, includeArchived: boolean): Promise<Project[]> {
    const { membership } = await this.workspaceAccess.require(userId, workspaceId);
    const canManage = hasAtLeastRole(membership.role, 'ADMIN');

    const conditions: SQL[] = [eq(projects.workspaceId, workspaceId)];
    if (!includeArchived) conditions.push(ne(projects.status, 'ARCHIVED'));
    if (!canManage) {
      conditions.push(
        inArray(
          projects.id,
          this.db
            .select({ id: projectMembers.projectId })
            .from(projectMembers)
            .where(eq(projectMembers.userId, userId)),
        ),
      );
    }
    const rows = await this.db
      .select({ project: projects, creator: creatorColumns, memberCount })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.createdBy))
      .where(and(...conditions))
      .orderBy(asc(projects.name));
    return rows.map((r) => toProject(r.project, r.creator, r.memberCount, canManage));
  }

  async get(userId: string, projectId: string): Promise<Project> {
    const { canManage } = await this.access.require(userId, projectId);
    return this.load(projectId, canManage);
  }

  async update(userId: string, projectId: string, input: UpdateProjectInput): Promise<Project> {
    const { project } = await this.access.require(userId, projectId, { manage: true });

    // Validate the resulting date range against the stored values, too.
    const startDate = input.startDate !== undefined ? input.startDate : project.startDate;
    const targetDate = input.targetDate !== undefined ? input.targetDate : project.targetDate;
    if (startDate && targetDate && targetDate < startDate) {
      throw AppException.validation([
        { path: 'targetDate', message: 'Target date must be on or after the start date.' },
      ]);
    }

    await this.db
      .update(projects)
      .set({
        name: input.name,
        description: input.description,
        status: input.status,
        startDate: input.startDate,
        targetDate: input.targetDate,
      })
      .where(eq(projects.id, projectId));
    return this.load(projectId, true);
  }

  /** M3 rule 3: DELETE archives; archived projects are read-only. */
  async archive(userId: string, projectId: string): Promise<void> {
    await this.access.require(userId, projectId, { manage: true });
    await this.db.update(projects).set({ status: 'ARCHIVED' }).where(eq(projects.id, projectId));
  }

  async listMembers(userId: string, projectId: string): Promise<ProjectMember[]> {
    await this.access.require(userId, projectId);
    const rows = await this.db
      .select({
        user: {
          id: users.id,
          username: users.username,
          avatarUrl: users.avatarUrl,
          email: users.email,
        },
        addedAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(users.username));
    return rows.map((r) => ({ user: r.user, addedAt: r.addedAt.toISOString() }));
  }

  /** Only existing workspace members can be added to a project (M3 rule 2). */
  async addMember(
    actorId: string,
    projectId: string,
    targetUserId: string,
  ): Promise<ProjectMember> {
    const { project } = await this.access.require(actorId, projectId, { manage: true });
    const [inWorkspace] = await this.db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, project.workspaceId),
          eq(workspaceMembers.userId, targetUserId),
        ),
      );
    if (!inWorkspace) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.NOT_WORKSPACE_MEMBER,
        'Only members of this workspace can be added to the project.',
      );
    }
    try {
      await this.db.insert(projectMembers).values({ projectId, userId: targetUserId });
    } catch (err) {
      if (isUniqueViolation(err, 'project_members_project_user_unique')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ALREADY_MEMBER,
          'This person is already a member of the project.',
        );
      }
      throw err;
    }
    const members = await this.listMembers(actorId, projectId);
    return members.find((m) => m.user.id === targetUserId)!;
  }

  /** Removing someone from a project also unassigns them from its tasks (M3 rule 7). */
  async removeMember(actorId: string, projectId: string, targetUserId: string): Promise<void> {
    await this.access.require(actorId, projectId, { manage: true });
    const removed = await this.db.transaction(async (tx) => {
      await tx
        .delete(taskAssignees)
        .where(
          and(
            eq(taskAssignees.userId, targetUserId),
            inArray(
              taskAssignees.taskId,
              tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)),
            ),
          ),
        );
      return tx
        .delete(projectMembers)
        .where(
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)),
        )
        .returning({ id: projectMembers.id });
    });
    if (removed.length === 0) throw AppException.notFound('Member not found.');
  }

  private async load(projectId: string, canManage: boolean): Promise<Project> {
    const [row] = await this.db
      .select({ project: projects, creator: creatorColumns, memberCount })
      .from(projects)
      .leftJoin(users, eq(users.id, projects.createdBy))
      .where(eq(projects.id, projectId));
    return toProject(row!.project, row!.creator, row!.memberCount, canManage);
  }
}

function toProject(
  p: ProjectRow,
  creator: Project['createdBy'],
  memberCount: number,
  canManage: boolean,
): Project {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    key: p.key,
    description: p.description,
    status: p.status,
    startDate: p.startDate,
    targetDate: p.targetDate,
    createdBy: creator,
    memberCount,
    viewerCanManage: canManage,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

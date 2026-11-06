import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  projectMembers,
  projects,
  taskAssignees,
  tasks,
  users,
  workspaceMembers,
  type Database,
} from '@devtrack/database';
import { ErrorCode, type AssignableWorkspaceRole, type WorkspaceMember } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import {
  canChangeRole,
  canRemoveMember,
  compareRoles,
  type PolicyDecision,
} from '../workspaces/workspace-policy';

type MemberRow = {
  membership: typeof workspaceMembers.$inferSelect;
  user: Pick<typeof users.$inferSelect, 'id' | 'username' | 'email' | 'avatarUrl'>;
};

const memberColumns = {
  membership: workspaceMembers,
  user: { id: users.id, username: users.username, email: users.email, avatarUrl: users.avatarUrl },
};

function toMember(row: MemberRow): WorkspaceMember {
  return {
    user: row.user,
    role: row.membership.role,
    joinedAt: row.membership.joinedAt.toISOString(),
  };
}

@Injectable()
export class MembersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Any member can see who else is in the workspace. Owner first, then admins, then members. */
  async list(actorId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    await this.access.require(actorId, workspaceId);
    const rows = await this.db
      .select(memberColumns)
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return rows
      .sort(
        (a, b) =>
          compareRoles(a.membership.role, b.membership.role) ||
          a.user.username.localeCompare(b.user.username),
      )
      .map(toMember);
  }

  async changeRole(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
    role: AssignableWorkspaceRole,
  ): Promise<WorkspaceMember> {
    const { membership: actor } = await this.access.require(actorId, workspaceId);
    const target = await this.findMember(workspaceId, targetUserId);
    enforce(canChangeRole(actor, target.membership));

    const [updated] = await this.db
      .update(workspaceMembers)
      .set({ role })
      .where(eq(workspaceMembers.id, target.membership.id))
      .returning();
    return toMember({ membership: updated!, user: target.user });
  }

  /** Removes a member, or lets a non-owner leave by targeting themselves. */
  async remove(actorId: string, workspaceId: string, targetUserId: string): Promise<void> {
    const { membership: actor } = await this.access.require(actorId, workspaceId);
    const target = await this.findMember(workspaceId, targetUserId);
    enforce(canRemoveMember(actor, target.membership));
    // Leaving a workspace also removes the person from its projects and unassigns their
    // tasks there (M3 rule 7), so no access or assignment outlives the membership.
    const workspaceProjects = this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await this.db.transaction(async (tx) => {
      await tx
        .delete(taskAssignees)
        .where(
          and(
            eq(taskAssignees.userId, targetUserId),
            inArray(
              taskAssignees.taskId,
              tx
                .select({ id: tasks.id })
                .from(tasks)
                .where(inArray(tasks.projectId, workspaceProjects)),
            ),
          ),
        );
      await tx
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.userId, targetUserId),
            inArray(projectMembers.projectId, workspaceProjects),
          ),
        );
      await tx.delete(workspaceMembers).where(eq(workspaceMembers.id, target.membership.id));
    });
  }

  private async findMember(workspaceId: string, userId: string): Promise<MemberRow> {
    const [row] = await this.db
      .select(memberColumns)
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .limit(1);
    if (!row) throw AppException.notFound('Member not found.');
    return row;
  }
}

function enforce(decision: PolicyDecision): void {
  if (decision.allowed) return;
  if (decision.reason === 'OWNER_PROTECTED') {
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.OWNER_PROTECTED,
      'The workspace owner cannot be removed or have their role changed.',
    );
  }
  throw AppException.forbidden('You do not have permission to manage this member.');
}

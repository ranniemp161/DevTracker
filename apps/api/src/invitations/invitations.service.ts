import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  invitations,
  isNull,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from '@devtrack/database';
import {
  ErrorCode,
  type AcceptInvitationResult,
  type AssignableWorkspaceRole,
  type Invitation,
  type InvitationStatus,
} from '@devtrack/types';
import type { CreateInvitationInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { generateToken, hashToken } from '../common/crypto/tokens';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { MAILER, type Mailer } from '../mail/mailer';
import { invitationEmail } from '../mail/templates';
import type { User } from '../users/users.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { toWorkspaceSummary } from '../workspaces/workspace.mapper';
import { canInvite } from '../workspaces/workspace-policy';

/** Architecture §6: invitations expire after seven days by default. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InvitationRow = typeof invitations.$inferSelect;

function statusOf(row: InvitationRow, now = Date.now()): InvitationStatus {
  if (row.acceptedAt) return 'ACCEPTED';
  if (row.revokedAt) return 'REVOKED';
  return row.expiresAt.getTime() <= now ? 'EXPIRED' : 'PENDING';
}

function toInvitation(
  row: InvitationRow,
  inviter: { id: string; username: string } | null,
): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role as AssignableWorkspaceRole,
    status: statusOf(row),
    invitedBy: inviter,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

const invitationInvalid = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.INVITATION_INVALID,
    'This invitation is invalid, has expired, or was already used.',
  );

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: WorkspaceAccessService,
  ) {}

  /**
   * Invites an email address. Re-inviting the same address revokes its previous open
   * invitation (approved M2 rule 4), so only the newest link works.
   */
  async create(
    actor: User,
    workspaceId: string,
    input: CreateInvitationInput,
  ): Promise<Invitation> {
    const { workspace, membership } = await this.access.require(actor.id, workspaceId);
    if (!canInvite(membership.role, input.role).allowed) {
      throw AppException.forbidden('You need to be a workspace admin to invite people.');
    }

    const [existingMember] = await this.db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, input.email)))
      .limit(1);
    if (existingMember) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_MEMBER,
        'This person is already a member of the workspace.',
      );
    }

    const token = generateToken();
    let row: InvitationRow;
    try {
      row = await this.db.transaction(async (tx) => {
        await tx
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(invitations.workspaceId, workspaceId),
              eq(invitations.email, input.email),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          );
        const [created] = await tx
          .insert(invitations)
          .values({
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: hashToken(token),
            invitedBy: actor.id,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          })
          .returning();
        return created!;
      });
    } catch (err) {
      // Two admins inviting the same address at the same moment.
      if (isUniqueViolation(err, 'invitations_one_open_per_email_idx')) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'An invitation for this email was just created. Please refresh.',
        );
      }
      throw err;
    }

    try {
      await this.mailer.send(
        invitationEmail({
          to: input.email,
          workspaceName: workspace.name,
          inviterName: actor.username,
          role: input.role,
          webOrigin: this.config.webOrigin,
          token,
        }),
      );
    } catch (err) {
      // The invitation exists; an admin can re-send by inviting again.
      this.logger.error(
        'Failed to send invitation email',
        err instanceof Error ? err.stack : String(err),
      );
    }

    return toInvitation(row, { id: actor.id, username: actor.username });
  }

  /** Open (pending or expired, not accepted or revoked) invitations. Admins only. */
  async listOpen(actorId: string, workspaceId: string): Promise<Invitation[]> {
    await this.access.require(actorId, workspaceId, 'ADMIN');
    const rows = await this.db
      .select({ invitation: invitations, inviter: { id: users.id, username: users.username } })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.workspaceId, workspaceId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .orderBy(desc(invitations.createdAt));
    return rows.map((r) => toInvitation(r.invitation, r.inviter));
  }

  /** Revokes an open invitation. Non-members of its workspace get 404. */
  async revoke(actorId: string, invitationId: string): Promise<Invitation> {
    if (!isUuid(invitationId)) throw AppException.notFound('Invitation not found.');
    const [existing] = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitationId))
      .limit(1);
    if (!existing) throw AppException.notFound('Invitation not found.');

    try {
      await this.access.require(actorId, existing.workspaceId, 'ADMIN');
    } catch (err) {
      // Do not reveal that the invitation exists to people outside its workspace.
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw AppException.notFound('Invitation not found.');
      }
      throw err;
    }

    const [revoked] = await this.db
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.id, invitationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning();
    if (!revoked) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVITATION_NOT_PENDING,
        'This invitation was already accepted or revoked.',
      );
    }
    return toInvitation(revoked, await this.inviterOf(revoked));
  }

  /**
   * Accepts an invitation (approved M2 rule 4):
   * - single use, unexpired, not revoked, workspace not archived;
   * - only by the account whose (verified) email the invitation was sent to, so a forwarded
   *   link grants nothing. The global guard already guarantees the email is verified.
   * Existing members keep their current role.
   */
  async accept(user: User, token: string): Promise<AcceptInvitationResult> {
    const [found] = await this.db
      .select({ invitation: invitations, workspace: workspaces })
      .from(invitations)
      .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
      .where(eq(invitations.tokenHash, hashToken(token)))
      .limit(1);
    if (!found || statusOf(found.invitation) !== 'PENDING' || found.workspace.archivedAt) {
      throw invitationInvalid();
    }
    if (found.invitation.email !== user.email) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.INVITATION_EMAIL_MISMATCH,
        'This invitation was sent to a different email address. Sign in with that account to accept it.',
      );
    }

    const role = await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.id, found.invitation.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .returning();
      if (!claimed) throw invitationInvalid(); // lost a race with another accept/revoke

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: claimed.workspaceId, userId: user.id, role: claimed.role })
        .onConflictDoNothing({ target: [workspaceMembers.workspaceId, workspaceMembers.userId] });

      const [membership] = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, claimed.workspaceId),
            eq(workspaceMembers.userId, user.id),
          ),
        );
      return membership!.role;
    });

    return { workspace: toWorkspaceSummary(found.workspace, role) };
  }

  private async inviterOf(row: InvitationRow) {
    if (!row.invitedBy) return null;
    const [inviter] = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, row.invitedBy));
    return inviter ?? null;
  }
}

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { AcceptInvitationResult, Invitation } from '@devtrack/types';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  type AcceptInvitationInput,
  type CreateInvitationInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import type { User } from '../users/users.service';
import { InvitationsService } from './invitations.service';

/** Architecture §9 — invitations. All routes require a session and a verified email. */
@Controller()
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('workspaces/:id/invitations')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
  ): Promise<{ invitation: Invitation }> {
    await this.rateLimit.consume(RATE_LIMITS.invitationCreatePerUser, user.id);
    await this.rateLimit.consume(RATE_LIMITS.invitationCreatePerWorkspace, workspaceId);
    return { invitation: await this.invitations.create(user, workspaceId, body) };
  }

  @Get('workspaces/:id/invitations')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
  ): Promise<Invitation[]> {
    return this.invitations.listOpen(user.id, workspaceId);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
  ): Promise<AcceptInvitationResult> {
    await this.rateLimit.consume(RATE_LIMITS.invitationAcceptPerUser, user.id);
    return this.invitations.accept(user, body.token);
  }

  @Post('invitations/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) invitationId: string,
  ): Promise<{ invitation: Invitation }> {
    return { invitation: await this.invitations.revoke(user.id, invitationId) };
  }
}

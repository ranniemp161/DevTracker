import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import type { WorkspaceMember } from '@devtrack/types';
import { changeMemberRoleSchema, type ChangeMemberRoleInput } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { MembersService } from './members.service';

/** Architecture §9 — workspace members. */
@Controller('workspaces/:id/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
  ): Promise<WorkspaceMember[]> {
    return this.members.list(user.id, workspaceId);
  }

  @Patch(':userId')
  async changeRole(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Param('userId', UuidParamPipe) targetUserId: string,
    @Body(new ZodValidationPipe(changeMemberRoleSchema)) body: ChangeMemberRoleInput,
  ): Promise<{ member: WorkspaceMember }> {
    return { member: await this.members.changeRole(user.id, workspaceId, targetUserId, body.role) };
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Param('userId', UuidParamPipe) targetUserId: string,
  ): Promise<void> {
    await this.members.remove(user.id, workspaceId, targetUserId);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { WorkspaceDetails, WorkspaceSummary } from '@devtrack/types';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import type { User } from '../users/users.service';
import { WorkspacesService } from './workspaces.service';

/** Architecture §9 — workspaces. All routes require a session and a verified email. */
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceInput,
  ): Promise<{ workspace: WorkspaceSummary }> {
    await this.rateLimit.consume(RATE_LIMITS.workspaceCreatePerUser, user.id);
    return { workspace: await this.workspaces.create(user.id, body.name) };
  }

  @Get()
  async list(@CurrentUser() user: User): Promise<WorkspaceSummary[]> {
    return this.workspaces.listForUser(user.id);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ workspace: WorkspaceDetails }> {
    return { workspace: await this.workspaces.get(user.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceInput,
  ): Promise<{ workspace: WorkspaceDetails }> {
    return { workspace: await this.workspaces.rename(user.id, id, body.name) };
  }

  /** Archives (does not hard-delete) — approved M2 rule 5. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.workspaces.archive(user.id, id);
  }
}

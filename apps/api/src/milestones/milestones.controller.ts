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
import type { Milestone } from '@devtrack/types';
import {
  createMilestoneCriterionSchema,
  createMilestoneSchema,
  updateMilestoneCriterionSchema,
  updateMilestoneSchema,
  type CreateMilestoneCriterionInput,
  type CreateMilestoneInput,
  type UpdateMilestoneCriterionInput,
  type UpdateMilestoneInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { MilestonesService } from './milestones.service';

/** Project milestones (M3 addition). */
@Controller()
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  @Get('projects/:id/milestones')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
  ): Promise<Milestone[]> {
    return this.milestones.list(user.id, projectId);
  }

  @Post('projects/:id/milestones')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(createMilestoneSchema)) body: CreateMilestoneInput,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.create(user.id, projectId, body) };
  }

  @Patch('milestones/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema)) body: UpdateMilestoneInput,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.update(user, id, body) };
  }

  @Delete('milestones/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.milestones.remove(user.id, id);
  }

  /** Acceptance criteria. Each call returns the whole updated milestone. */
  @Post('milestones/:id/criteria')
  @HttpCode(HttpStatus.CREATED)
  async addCriterion(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(createMilestoneCriterionSchema))
    body: CreateMilestoneCriterionInput,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.addCriterion(user.id, id, body) };
  }

  @Patch('milestone-criteria/:id')
  async updateCriterion(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateMilestoneCriterionSchema))
    body: UpdateMilestoneCriterionInput,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.updateCriterion(user.id, id, body) };
  }

  @Delete('milestone-criteria/:id')
  async removeCriterion(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.removeCriterion(user.id, id) };
  }
}

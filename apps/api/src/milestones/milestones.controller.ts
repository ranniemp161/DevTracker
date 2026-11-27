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
import type { GithubRelease, Milestone } from '@devtrack/types';
import {
  createMilestoneCriterionSchema,
  createMilestoneSchema,
  linkMilestoneReleaseSchema,
  updateMilestoneCriterionSchema,
  updateMilestoneSchema,
  type CreateMilestoneCriterionInput,
  type CreateMilestoneInput,
  type LinkMilestoneReleaseInput,
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

  /** 0026: releases of the project's connected repositories, for the Link release picker. */
  @Get('projects/:id/releases')
  async releases(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
  ): Promise<GithubRelease[]> {
    return this.milestones.releases(user.id, projectId);
  }

  @Post('milestones/:id/releases')
  async linkRelease(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(linkMilestoneReleaseSchema)) body: LinkMilestoneReleaseInput,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.linkRelease(user, id, body.releaseId) };
  }

  @Delete('milestones/:id/releases/:releaseId')
  async unlinkRelease(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Param('releaseId', UuidParamPipe) releaseId: string,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.unlinkRelease(user, id, releaseId) };
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
    return { milestone: await this.milestones.addCriterion(user, id, body) };
  }

  @Patch('milestone-criteria/:id')
  async updateCriterion(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateMilestoneCriterionSchema))
    body: UpdateMilestoneCriterionInput,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.updateCriterion(user, id, body) };
  }

  @Delete('milestone-criteria/:id')
  async removeCriterion(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ milestone: Milestone }> {
    return { milestone: await this.milestones.removeCriterion(user, id) };
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import type { Label } from '@devtrack/types';
import {
  createLabelSchema,
  updateLabelSchema,
  type CreateLabelInput,
  type UpdateLabelInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { LabelsService } from './labels.service';

/** Workspace labels (M3 addition; §9 only listed attach/detach on tasks). */
@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('workspaces/:id/labels')
  list(@CurrentUser() user: User, @Param('id', UuidParamPipe) workspaceId: string): Promise<Label[]> {
    return this.labels.list(user.id, workspaceId);
  }

  @Post('workspaces/:id/labels')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Body(new ZodValidationPipe(createLabelSchema)) body: CreateLabelInput,
  ): Promise<{ label: Label }> {
    return { label: await this.labels.create(user.id, workspaceId, body) };
  }

  @Patch('labels/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateLabelSchema)) body: UpdateLabelInput,
  ): Promise<{ label: Label }> {
    return { label: await this.labels.update(user.id, id, body) };
  }

  @Delete('labels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.labels.remove(user.id, id);
  }
}

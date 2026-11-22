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
  Put,
} from '@nestjs/common';
import type { TaskChecklistItem } from '@devtrack/types';
import {
  createChecklistItemSchema,
  reorderChecklistSchema,
  updateChecklistItemSchema,
  type CreateChecklistItemInput,
  type ReorderChecklistInput,
  type UpdateChecklistItemInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { TaskChecklistService } from './task-checklist.service';

/** Decision record 0018 — a task's checklist. */
@Controller()
export class TaskChecklistController {
  constructor(private readonly checklist: TaskChecklistService) {}

  @Get('tasks/:id/checklist')
  async list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
  ): Promise<{ items: TaskChecklistItem[] }> {
    return { items: await this.checklist.list(user.id, taskId) };
  }

  @Post('tasks/:id/checklist')
  @HttpCode(HttpStatus.CREATED)
  async add(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(createChecklistItemSchema)) body: CreateChecklistItemInput,
  ): Promise<{ item: TaskChecklistItem }> {
    return { item: await this.checklist.add(user, taskId, body) };
  }

  @Put('tasks/:id/checklist/order')
  async reorder(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(reorderChecklistSchema)) body: ReorderChecklistInput,
  ): Promise<{ items: TaskChecklistItem[] }> {
    return { items: await this.checklist.reorder(user, taskId, body) };
  }

  @Patch('checklist-items/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) itemId: string,
    @Body(new ZodValidationPipe(updateChecklistItemSchema)) body: UpdateChecklistItemInput,
  ): Promise<{ item: TaskChecklistItem }> {
    return { item: await this.checklist.update(user, itemId, body) };
  }

  @Delete('checklist-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) itemId: string,
  ): Promise<void> {
    await this.checklist.remove(user, itemId);
  }
}

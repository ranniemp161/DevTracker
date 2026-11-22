import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { RelatedTask } from '@devtrack/types';
import { createTaskRelationSchema, type CreateTaskRelationInput } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { TaskRelationsService } from './task-relations.service';

/** Decision record 0020 — blocks / blocked by / related to. */
@Controller()
export class TaskRelationsController {
  constructor(private readonly relations: TaskRelationsService) {}

  @Get('tasks/:id/relations')
  async list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
  ): Promise<{ relations: RelatedTask[] }> {
    return { relations: await this.relations.list(user.id, taskId) };
  }

  @Post('tasks/:id/relations')
  @HttpCode(HttpStatus.CREATED)
  async add(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(createTaskRelationSchema)) body: CreateTaskRelationInput,
  ): Promise<{ relations: RelatedTask[] }> {
    return { relations: await this.relations.add(user, taskId, body) };
  }

  @Delete('tasks/:id/relations/:relationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Param('relationId', UuidParamPipe) relationId: string,
  ): Promise<void> {
    await this.relations.remove(user, taskId, relationId);
  }
}

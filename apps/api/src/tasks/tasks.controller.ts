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
  Query,
} from '@nestjs/common';
import type { Task } from '@devtrack/types';
import {
  addAssigneesSchema,
  attachLabelSchema,
  changeTaskStatusSchema,
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
  type AddAssigneesInput,
  type AttachLabelInput,
  type ChangeTaskStatusInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type UpdateTaskInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import type { Paginated } from '../common/http/paginated';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import type { User } from '../users/users.service';
import { TasksService } from './tasks.service';

/** Architecture §9 — tasks. */
@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('projects/:id/tasks')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ): Promise<{ task: Task }> {
    await this.rateLimit.consume(RATE_LIMITS.taskCreatePerUser, user.id);
    return { task: await this.tasks.create(user, projectId, body) };
  }

  @Get('projects/:id/tasks')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
  ): Promise<Paginated<Task>> {
    return this.tasks.list(user.id, projectId, query);
  }

  @Get('tasks/:id')
  async get(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.get(user.id, id) };
  }

  @Patch('tasks/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.update(user, id, body) };
  }

  @Patch('tasks/:id/status')
  async changeStatus(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(changeTaskStatusSchema)) body: ChangeTaskStatusInput,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.update(user, id, { status: body.status }) };
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.tasks.remove(user, id);
  }

  @Post('tasks/:id/assignees')
  @HttpCode(HttpStatus.OK)
  async addAssignees(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(addAssigneesSchema)) body: AddAssigneesInput,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.addAssignees(user, id, body.userIds) };
  }

  @Delete('tasks/:id/assignees/:userId')
  async removeAssignee(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Param('userId', UuidParamPipe) userId: string,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.removeAssignee(user, id, userId) };
  }

  @Post('tasks/:id/labels')
  @HttpCode(HttpStatus.OK)
  async addLabel(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(attachLabelSchema)) body: AttachLabelInput,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.addLabel(user, id, body.labelId) };
  }

  @Delete('tasks/:id/labels/:labelId')
  async removeLabel(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Param('labelId', UuidParamPipe) labelId: string,
  ): Promise<{ task: Task }> {
    return { task: await this.tasks.removeLabel(user, id, labelId) };
  }
}

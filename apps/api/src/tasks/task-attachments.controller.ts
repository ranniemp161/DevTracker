import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { createTaskAttachmentSchema, type CreateTaskAttachmentInput } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { TaskAttachmentsService } from './task-attachments.service';

@Controller('tasks/:taskId/attachments')
export class TaskAttachmentsController {
  constructor(private readonly attachments: TaskAttachmentsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: User, @Param('taskId', UuidParamPipe) taskId: string) {
    return this.attachments.list(user.id, taskId);
  }

  @Post()
  prepare(
    @CurrentUser() user: User,
    @Param('taskId', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(createTaskAttachmentSchema)) body: CreateTaskAttachmentInput,
  ) {
    return this.attachments.prepare(user.id, taskId, body);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: User,
    @Param('taskId', UuidParamPipe) taskId: string,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.attachments.complete(user.id, taskId, id);
  }
}

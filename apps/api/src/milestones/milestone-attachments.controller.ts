import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { createTaskAttachmentSchema, type CreateTaskAttachmentInput } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { MilestoneAttachmentsService } from './milestone-attachments.service';

/** 0030 §5: files on a milestone's brief; same types, limits and upload flow as tasks. */
@Controller('milestones/:milestoneId/attachments')
export class MilestoneAttachmentsController {
  constructor(private readonly attachments: MilestoneAttachmentsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: User, @Param('milestoneId', UuidParamPipe) milestoneId: string) {
    return this.attachments.list(user.id, milestoneId);
  }

  @Post()
  prepare(
    @CurrentUser() user: User,
    @Param('milestoneId', UuidParamPipe) milestoneId: string,
    @Body(new ZodValidationPipe(createTaskAttachmentSchema)) body: CreateTaskAttachmentInput,
  ) {
    return this.attachments.prepare(user.id, milestoneId, body);
  }

  @Get(':id/content')
  @Header('Cache-Control', 'private, no-store')
  content(
    @CurrentUser() user: User,
    @Param('milestoneId', UuidParamPipe) milestoneId: string,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.attachments.markdown(user.id, milestoneId, id);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: User,
    @Param('milestoneId', UuidParamPipe) milestoneId: string,
    @Param('id', UuidParamPipe) id: string,
  ) {
    return this.attachments.complete(user.id, milestoneId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: User,
    @Param('milestoneId', UuidParamPipe) milestoneId: string,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<void> {
    await this.attachments.remove(user.id, milestoneId, id);
  }
}

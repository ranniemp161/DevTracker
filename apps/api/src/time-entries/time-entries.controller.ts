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
import type { TimeEntry } from '@devtrack/types';
import {
  createTimeEntrySchema,
  updateTimeEntrySchema,
  type CreateTimeEntryInput,
  type UpdateTimeEntryInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { TimeEntriesService } from './time-entries.service';

/** Decision record 0012 — time logged against tasks. */
@Controller()
export class TimeEntriesController {
  constructor(private readonly entries: TimeEntriesService) {}

  @Get('tasks/:id/time-entries')
  async list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
  ): Promise<{ entries: TimeEntry[] }> {
    return { entries: await this.entries.list(user.id, taskId) };
  }

  @Post('tasks/:id/time-entries')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(createTimeEntrySchema)) body: CreateTimeEntryInput,
  ): Promise<{ entry: TimeEntry }> {
    return { entry: await this.entries.create(user, taskId, body) };
  }

  @Patch('time-entries/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateTimeEntrySchema)) body: UpdateTimeEntryInput,
  ): Promise<{ entry: TimeEntry }> {
    return { entry: await this.entries.update(user, id, body) };
  }

  @Delete('time-entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.entries.remove(user, id);
  }
}

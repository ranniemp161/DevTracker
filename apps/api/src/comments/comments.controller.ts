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
import type { Comment, TimelineItem } from '@devtrack/types';
import {
  createCommentSchema,
  listCommentsQuerySchema,
  listTimelineQuerySchema,
  updateCommentSchema,
  type CreateCommentInput,
  type ListCommentsQuery,
  type ListTimelineQuery,
  type UpdateCommentInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import type { Paginated } from '../common/http/paginated';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import type { User } from '../users/users.service';
import { CommentsService } from './comments.service';

/** Architecture §9 — comments. */
@Controller()
export class CommentsController {
  constructor(
    private readonly comments: CommentsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('tasks/:id/comments')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: CreateCommentInput,
  ): Promise<{ comment: Comment }> {
    await this.rateLimit.consume(RATE_LIMITS.commentCreatePerUser, user.id);
    return { comment: await this.comments.create(user, taskId, body.body) };
  }

  @Get('tasks/:id/comments')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Query(new ZodValidationPipe(listCommentsQuerySchema)) query: ListCommentsQuery,
  ): Promise<Paginated<Comment>> {
    return this.comments.list(user.id, taskId, query);
  }

  @Get('tasks/:id/timeline')
  timeline(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Query(new ZodValidationPipe(listTimelineQuerySchema)) query: ListTimelineQuery,
  ): Promise<Paginated<TimelineItem>> {
    return this.comments.timeline(user.id, taskId, query);
  }

  @Patch('comments/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateCommentSchema)) body: UpdateCommentInput,
  ): Promise<{ comment: Comment }> {
    return { comment: await this.comments.update(user, id, body.body) };
  }

  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.comments.remove(user, id);
  }
}

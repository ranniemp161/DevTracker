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
  Query,
} from '@nestjs/common';
import type {
  ProjectChatReadState,
  ProjectChatUnreadSummary,
  ProjectMessage,
  ProjectMessagePage,
} from '@devtrack/types';
import {
  createChatMessageSchema,
  listChatMessagesQuerySchema,
  markChatReadSchema,
  updateChatMessageSchema,
  type CreateChatMessageInput,
  type ListChatMessagesQuery,
  type MarkChatReadInput,
  type UpdateChatMessageInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import type { User } from '../users/users.service';
import { ChatService } from './chat.service';

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('projects/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  async createMessage(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(createChatMessageSchema)) body: CreateChatMessageInput,
  ): Promise<{ message: ProjectMessage }> {
    await this.rateLimit.consume(RATE_LIMITS.commentCreatePerUser, user.id);
    return { message: await this.chat.create(user, projectId, body) };
  }

  @Get('projects/:id/messages')
  async listMessages(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Query(new ZodValidationPipe(listChatMessagesQuerySchema)) query: ListChatMessagesQuery,
  ): Promise<ProjectMessagePage> {
    return this.chat.list(user.id, projectId, query);
  }

  @Patch('messages/:id')
  async updateMessage(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateChatMessageSchema)) body: UpdateChatMessageInput,
  ): Promise<{ message: ProjectMessage }> {
    await this.rateLimit.consume(RATE_LIMITS.commentCreatePerUser, user.id);
    return { message: await this.chat.update(user, id, body) };
  }

  @Delete('messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<void> {
    await this.chat.remove(user, id);
  }

  @Put('projects/:id/chat/read')
  async markRead(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(markChatReadSchema)) body: MarkChatReadInput,
  ): Promise<{ readState: ProjectChatReadState }> {
    return { readState: await this.chat.markRead(user, projectId, body.sequence) };
  }

  @Get('workspaces/:id/chat/unread')
  async getWorkspaceUnread(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
  ): Promise<ProjectChatUnreadSummary[]> {
    return this.chat.getWorkspaceUnread(user.id, workspaceId);
  }
}

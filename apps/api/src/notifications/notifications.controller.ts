import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { Notification } from '@devtrack/types';
import { listNotificationsQuerySchema, type ListNotificationsQuery } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import type { Paginated } from '../common/http/paginated';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { NotificationsService } from './notifications.service';

/** Architecture §9 — notifications (always the signed-in user's own). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<Paginated<Notification>> {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: User): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ notification: Notification }> {
    return { notification: await this.notifications.markRead(user, id) };
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: User): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user);
  }
}

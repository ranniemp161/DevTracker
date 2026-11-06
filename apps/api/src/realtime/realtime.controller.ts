import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentSession, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { requireCronSecret } from '../common/guards/cron-secret';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { Session } from '../auth/sessions.service';
import type { User } from '../users/users.service';
import { OutboxPublisher, type FlushResult } from './outbox-publisher.service';
import { issueTicket } from './realtime-ticket';

@Controller()
export class RealtimeController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly publisher: OutboxPublisher,
  ) {}

  /**
   * M7 addition: a 60-second ticket for opening the socket. Requested through the website's
   * same-origin proxy, so the session cookie authenticates it (decision record 0007).
   */
  @Post('realtime/token')
  @HttpCode(HttpStatus.OK)
  token(
    @CurrentUser() user: User,
    @CurrentSession() session: Session,
  ): { token: string; expiresAt: string } {
    const ticket = issueTicket(this.config.realtime.secret, { sid: session.id, uid: user.id });
    return { token: ticket.token, expiresAt: ticket.expiresAt.toISOString() };
  }

  /** Scheduled sweep for outbox rows the after-response flush missed. */
  @Public()
  @Get('internal/realtime/outbox/flush')
  flush(@Req() req: Request): Promise<FlushResult> {
    requireCronSecret(this.config, req);
    return this.publisher.flush();
  }
}

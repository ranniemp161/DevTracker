import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import type { Session } from '../auth/sessions.service';
import { CurrentSession } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProjectAccessService } from '../projects/project-access.service';
import { ChatPushService } from './chat-push.service';

const preferenceSchema = z.object({ mode: z.enum(['off', 'mentions', 'all']) });

const subscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => {
      const url = URL.parse(value);
      if (
        !url ||
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.hash
      ) {
        return false;
      }
      const { hostname, pathname } = url;
      return (
        (hostname === 'fcm.googleapis.com' &&
          (pathname.startsWith('/fcm/send/') || pathname.startsWith('/wp/'))) ||
        (hostname === 'updates.push.services.mozilla.com' && pathname.startsWith('/wpush/')) ||
        hostname === 'web.push.apple.com' ||
        /^[a-z0-9-]+\.push\.apple\.com$/.test(hostname) ||
        /^[a-z0-9-]+\.notify\.windows\.com$/.test(hostname)
      );
    }, 'This browser uses an unsupported push provider.'),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});

@Controller()
export class ChatPushController {
  constructor(
    private readonly push: ChatPushService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('projects/:id/chat/phone-notifications')
  async settings(
    @CurrentSession() session: Session,
    @Param('id', UuidParamPipe) projectId: string,
  ) {
    await this.access.require(session.userId, projectId);
    return this.push.settings(session.userId, session.id, projectId);
  }

  @Put('projects/:id/chat/phone-notifications')
  @HttpCode(204)
  async setMode(
    @CurrentSession() session: Session,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(preferenceSchema)) { mode }: z.infer<typeof preferenceSchema>,
  ) {
    await this.access.require(session.userId, projectId);
    await this.push.setMode(session.userId, projectId, mode);
  }

  @Put('chat/phone-notifications/device')
  @HttpCode(204)
  async enable(
    @CurrentSession() session: Session,
    @Body(new ZodValidationPipe(subscriptionSchema)) body: z.infer<typeof subscriptionSchema>,
  ) {
    await this.push.enable(session.id, body);
  }

  @Delete('chat/phone-notifications/device')
  @HttpCode(204)
  async disable(@CurrentSession() session: Session) {
    await this.push.disable(session.id);
  }
}

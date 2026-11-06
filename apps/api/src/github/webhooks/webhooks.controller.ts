import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/auth.decorators';
import { requireCronSecret } from '../../common/guards/cron-secret';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { WebhookDeliveriesService } from './webhook-deliveries.service';

/**
 * Isolated from user-authenticated controllers (§12): authorized by HMAC signature (webhook)
 * or a bearer secret (retry job), never by a session.
 */
@Controller()
export class WebhooksController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly deliveries: WebhookDeliveriesService,
  ) {}

  /**
   * `POST /api/v1/webhooks/github` (architecture §11.4). The raw body is kept by
   * `configureApp`. 202 means the delivery is stored durably, even if processing failed and
   * will be retried.
   */
  @Public()
  @Post('webhooks/github')
  @HttpCode(HttpStatus.ACCEPTED)
  receive(@Req() req: Request) {
    return this.deliveries.receive(
      {
        event: req.header('x-github-event'),
        deliveryId: req.header('x-github-delivery'),
        signature: req.header('x-hub-signature-256'),
      },
      req.body,
    );
  }

  /**
   * Scheduled retry of failed deliveries (decision record 0006). GET because Vercel Cron calls
   * jobs with GET and `Authorization: Bearer $CRON_SECRET`. Hidden (404) when not configured.
   */
  @Public()
  @Get('internal/github/deliveries/retry')
  async retry(@Req() req: Request) {
    requireCronSecret(this.config, req);
    return this.deliveries.retryPending();
  }
}

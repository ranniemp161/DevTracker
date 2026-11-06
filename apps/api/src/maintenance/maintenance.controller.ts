import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/auth.decorators';
import { requireCronSecret } from '../common/guards/cron-secret';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { MaintenanceService, type OpsStatus, type PruneResult } from './maintenance.service';

/** Scheduled jobs and monitoring (Bearer `CRON_SECRET`; decision record 0008). */
@Controller('internal')
export class MaintenanceController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly maintenance: MaintenanceService,
  ) {}

  /** Daily retention cleanup. */
  @Public()
  @Get('maintenance/prune')
  prune(@Req() req: Request): Promise<PruneResult> {
    requireCronSecret(this.config, req);
    return this.maintenance.prune();
  }

  /** Outbox backlog and webhook delivery health, for monitoring. */
  @Public()
  @Get('status')
  status(@Req() req: Request): Promise<OpsStatus> {
    requireCronSecret(this.config, req);
    return this.maintenance.status();
  }
}

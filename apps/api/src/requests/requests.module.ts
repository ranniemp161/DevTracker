import { Module } from '@nestjs/common';
import { ClientUpdatesModule } from '../client-updates/client-updates.module';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TasksModule } from '../tasks/tasks.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TurnstileVerifier } from './turnstile.service';

/** Public request forms and Triage (decision record 0016). */
@Module({
  imports: [ClientUpdatesModule, ProjectsModule, RateLimitModule, TasksModule],
  controllers: [RequestsController],
  providers: [RequestsService, TurnstileVerifier],
  exports: [RequestsService],
})
export class RequestsModule {}

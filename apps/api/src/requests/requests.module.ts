import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TurnstileVerifier } from './turnstile.service';

/** Public request forms and Triage (decision record 0016). */
@Module({
  imports: [ProjectsModule, RateLimitModule],
  controllers: [RequestsController],
  providers: [RequestsService, TurnstileVerifier],
  exports: [RequestsService],
})
export class RequestsModule {}

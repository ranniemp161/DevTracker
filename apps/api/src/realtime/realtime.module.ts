import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { OutboxPublisher } from './outbox-publisher.service';
import { PublishAfterResponseInterceptor } from './publish-after-response.interceptor';
import { RealtimeController } from './realtime.controller';
import { RealtimeGateway } from './realtime.gateway';

/** Real-time delivery (architecture §10, M7). */
@Module({
  imports: [AuthModule, WorkspacesModule, ProjectsModule],
  controllers: [RealtimeController],
  providers: [
    OutboxPublisher,
    RealtimeGateway,
    { provide: APP_INTERCEPTOR, useClass: PublishAfterResponseInterceptor },
  ],
  exports: [OutboxPublisher],
})
export class RealtimeModule {}

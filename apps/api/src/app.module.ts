import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { OriginGuard } from './common/guards/origin.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { CommentsModule } from './comments/comments.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { GithubModule } from './github/github.module';
import { HealthController } from './health/health.controller';
import { InvitationsModule } from './invitations/invitations.module';
import { LabelsModule } from './labels/labels.module';
import { MailModule } from './mail/mail.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MembersModule } from './members/members.module';
import { MilestonesModule } from './milestones/milestones.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsModule,
    MailModule,
    AuthModule,
    WorkspacesModule,
    MembersModule,
    InvitationsModule,
    ProjectsModule,
    TasksModule,
    LabelsModule,
    MilestonesModule,
    CommentsModule,
    ActivityModule,
    NotificationsModule,
    GithubModule,
    RealtimeModule,
    MaintenanceModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global guards run in this order: CSRF origin check, then authentication.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TaskAccessService } from './task-access.service';
import { TaskAttachmentsController } from './task-attachments.controller';
import { TaskAttachmentsService } from './task-attachments.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [ProjectsModule, RateLimitModule, WorkspacesModule],
  controllers: [TasksController, TaskAttachmentsController],
  providers: [TasksService, TaskAccessService, TaskAttachmentsService],
  exports: [TaskAccessService],
})
export class TasksModule {}

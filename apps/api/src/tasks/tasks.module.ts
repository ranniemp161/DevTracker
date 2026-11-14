import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TaskAccessService } from './task-access.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [ProjectsModule, RateLimitModule, WorkspacesModule],
  controllers: [TasksController],
  providers: [TasksService, TaskAccessService],
  exports: [TaskAccessService],
})
export class TasksModule {}

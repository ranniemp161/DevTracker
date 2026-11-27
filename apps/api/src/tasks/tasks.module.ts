import { Module } from '@nestjs/common';
import { MilestonesModule } from '../milestones/milestones.module';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TaskAccessService } from './task-access.service';
import { TaskAttachmentsController } from './task-attachments.controller';
import { TaskAttachmentsService } from './task-attachments.service';
import { TaskChecklistController } from './task-checklist.controller';
import { TaskChecklistService } from './task-checklist.service';
import { TaskRelationsController } from './task-relations.controller';
import { TaskRelationsService } from './task-relations.service';
import { TaskDonePrompts } from './task-done-prompts.service';
import { TaskStatusAutomation } from './task-status-automation.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [ProjectsModule, MilestonesModule, RateLimitModule, WorkspacesModule],
  controllers: [
    TasksController,
    TaskAttachmentsController,
    TaskChecklistController,
    TaskRelationsController,
  ],
  providers: [
    TasksService,
    TaskAccessService,
    TaskAttachmentsService,
    TaskChecklistService,
    TaskRelationsService,
    TaskStatusAutomation,
    TaskDonePrompts,
  ],
  exports: [
    TasksService,
    TaskAccessService,
    TaskStatusAutomation,
    TaskDonePrompts,
    TaskAttachmentsService,
  ],
})
export class TasksModule {}

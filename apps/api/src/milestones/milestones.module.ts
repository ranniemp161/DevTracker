import { Module } from '@nestjs/common';
import { ClientUpdatesModule } from '../client-updates/client-updates.module';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MilestoneAttachmentsController } from './milestone-attachments.controller';
import { MilestoneAttachmentsService } from './milestone-attachments.service';
import { MilestoneReadinessService } from './milestone-readiness.service';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

@Module({
  imports: [ClientUpdatesModule, ProjectsModule, RateLimitModule, WorkspacesModule],
  controllers: [MilestonesController, MilestoneAttachmentsController],
  providers: [MilestonesService, MilestoneReadinessService, MilestoneAttachmentsService],
  exports: [MilestoneReadinessService],
})
export class MilestonesModule {}

import { Module } from '@nestjs/common';
import { ClientUpdatesModule } from '../client-updates/client-updates.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MilestoneReadinessService } from './milestone-readiness.service';
import { MilestonesController } from './milestones.controller';
import { MilestonesService } from './milestones.service';

@Module({
  imports: [ClientUpdatesModule, ProjectsModule, WorkspacesModule],
  controllers: [MilestonesController],
  providers: [MilestonesService, MilestoneReadinessService],
  exports: [MilestoneReadinessService],
})
export class MilestonesModule {}

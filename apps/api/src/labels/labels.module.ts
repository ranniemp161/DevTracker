import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [LabelsController],
  providers: [LabelsService],
})
export class LabelsModule {}

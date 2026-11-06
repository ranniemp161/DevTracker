import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}

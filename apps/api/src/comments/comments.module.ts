import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TasksModule } from '../tasks/tasks.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [TasksModule, ProjectsModule, RateLimitModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}

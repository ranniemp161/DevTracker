import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { GithubAppClient } from './github-app.client';
import { GithubInstallationsController } from './installations/installations.controller';
import { GithubInstallationsService } from './installations/installations.service';
import { ProjectRepositoriesController } from './repositories/project-repositories.controller';
import { ProjectRepositoriesService } from './repositories/project-repositories.service';

/**
 * GitHub App integration (architecture §11). M5: installation and repository selection.
 * Webhooks, commits, pull requests and reviews arrive in M6.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, ProjectsModule],
  controllers: [GithubInstallationsController, ProjectRepositoriesController],
  providers: [GithubAppClient, GithubInstallationsService, ProjectRepositoriesService],
})
export class GithubModule {}

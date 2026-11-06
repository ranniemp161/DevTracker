import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { GithubAppClient } from './github-app.client';
import { GithubInstallationsController } from './installations/installations.controller';
import { GithubInstallationsService } from './installations/installations.service';
import { PullRequestsController } from './pull-requests/pull-requests.controller';
import { PullRequestsService } from './pull-requests/pull-requests.service';
import { ProjectRepositoriesController } from './repositories/project-repositories.controller';
import { ProjectRepositoriesService } from './repositories/project-repositories.service';
import { GithubEventProcessor } from './webhooks/github-event-processor.service';
import { WebhookDeliveriesService } from './webhooks/webhook-deliveries.service';
import { WebhooksController } from './webhooks/webhooks.controller';

/**
 * GitHub App integration (architecture §11).
 * M5: installation and repository selection. M6: webhooks, commits, pull requests, reviews,
 * releases and task links.
 */
@Module({
  imports: [AuthModule, WorkspacesModule, ProjectsModule, TasksModule],
  controllers: [
    GithubInstallationsController,
    ProjectRepositoriesController,
    PullRequestsController,
    WebhooksController,
  ],
  providers: [
    GithubAppClient,
    GithubInstallationsService,
    ProjectRepositoriesService,
    PullRequestsService,
    GithubEventProcessor,
    WebhookDeliveriesService,
  ],
})
export class GithubModule {}

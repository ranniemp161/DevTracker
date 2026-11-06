import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { LinkedPullRequest, PullRequest } from '@devtrack/types';
import {
  linkPullRequestSchema,
  listPullRequestsQuerySchema,
  type LinkPullRequestInput,
  type ListPullRequestsQuery,
} from '@devtrack/validators';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { Paginated } from '../../common/http/paginated';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { User } from '../../users/users.service';
import { PullRequestsService } from './pull-requests.service';

/** Architecture §9 "GitHub": pull requests and task links. */
@Controller()
export class PullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Get('repositories/:id/pull-requests')
  listForRepository(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) repositoryId: string,
    @Query(new ZodValidationPipe(listPullRequestsQuerySchema)) query: ListPullRequestsQuery,
  ): Promise<Paginated<PullRequest>> {
    return this.pullRequests.listForRepository(user.id, repositoryId, query);
  }

  /** M6 addition: the task's linked pull requests. */
  @Get('tasks/:id/pull-requests')
  listForTask(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
  ): Promise<LinkedPullRequest[]> {
    return this.pullRequests.listForTask(user.id, taskId);
  }

  @Post('tasks/:id/pull-requests')
  @HttpCode(HttpStatus.CREATED)
  async link(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Body(new ZodValidationPipe(linkPullRequestSchema)) body: LinkPullRequestInput,
  ): Promise<{ pullRequest: LinkedPullRequest }> {
    return { pullRequest: await this.pullRequests.link(user, taskId, body.pullRequestId) };
  }

  @Delete('tasks/:id/pull-requests/:prId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) taskId: string,
    @Param('prId', UuidParamPipe) prId: string,
  ): Promise<void> {
    await this.pullRequests.unlink(user, taskId, prId);
  }
}

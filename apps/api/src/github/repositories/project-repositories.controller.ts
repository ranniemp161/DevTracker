import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { ConnectedRepository } from '@devtrack/types';
import { connectRepositorySchema, type ConnectRepositoryInput } from '@devtrack/validators';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { User } from '../../users/users.service';
import { ProjectRepositoriesService } from './project-repositories.service';

/** Architecture §9 "GitHub": repositories connected to a project. */
@Controller('projects/:id/repositories')
export class ProjectRepositoriesController {
  constructor(private readonly repositories: ProjectRepositoriesService) {}

  @Get()
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
  ): Promise<ConnectedRepository[]> {
    return this.repositories.list(user.id, projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async connect(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(connectRepositorySchema)) body: ConnectRepositoryInput,
  ): Promise<{ repository: ConnectedRepository }> {
    return { repository: await this.repositories.connect(user, projectId, body) };
  }

  @Delete(':repoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Param('repoId', UuidParamPipe) repoId: string,
  ): Promise<void> {
    await this.repositories.disconnect(user, projectId, repoId);
  }
}

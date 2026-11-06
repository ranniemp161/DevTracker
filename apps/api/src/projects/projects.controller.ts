import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Project, ProjectMember } from '@devtrack/types';
import {
  addProjectMemberSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
  type AddProjectMemberInput,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { ProjectsService } from './projects.service';

/** Architecture §9 — projects. */
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post('workspaces/:id/projects')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
  ): Promise<{ project: Project }> {
    return { project: await this.projects.create(user.id, workspaceId, body) };
  }

  @Get('workspaces/:id/projects')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Query(new ZodValidationPipe(listProjectsQuerySchema)) query: { includeArchived: boolean },
  ): Promise<Project[]> {
    return this.projects.list(user.id, workspaceId, query.includeArchived);
  }

  @Get('projects/:id')
  async get(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ project: Project }> {
    return { project: await this.projects.get(user.id, id) };
  }

  @Patch('projects/:id')
  async update(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
  ): Promise<{ project: Project }> {
    return { project: await this.projects.update(user.id, id, body) };
  }

  @Delete('projects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.projects.archive(user.id, id);
  }

  @Get('projects/:id/members')
  members(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<ProjectMember[]> {
    return this.projects.listMembers(user.id, id);
  }

  @Post('projects/:id/members')
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) body: AddProjectMemberInput,
  ): Promise<{ member: ProjectMember }> {
    return { member: await this.projects.addMember(user.id, id, body.userId.toLowerCase()) };
  }

  @Delete('projects/:id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Param('userId', UuidParamPipe) userId: string,
  ): Promise<void> {
    await this.projects.removeMember(user.id, id, userId);
  }
}

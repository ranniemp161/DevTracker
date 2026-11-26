import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { ProjectIntake, PublicIntakeInfo, RequestReceipt, TaskRequest } from '@devtrack/types';
import {
  declineRequestSchema,
  listProposalsQuerySchema,
  listRequestsQuerySchema,
  proposeTaskSchema,
  setIntakeSchema,
  submitRequestSchema,
  type DeclineRequestInput,
  type ListProposalsQuery,
  type ListRequestsQuery,
  type ProposeTaskInput,
  type SetIntakeInput,
  type SubmitRequestInput,
} from '@devtrack/validators';
import type { Request } from 'express';
import { CurrentUser, Public } from '../common/decorators/auth.decorators';
import { clientIp } from '../common/http/request-context';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { RequestsService } from './requests.service';

/** Public request forms and Triage (decision record 0016). */
@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  /** What the public form page shows: the project name only. */
  @Public()
  @Get('public/requests/:token')
  form(@Param('token') token: string): Promise<PublicIntakeInfo> {
    return this.requests.form(token);
  }

  @Public()
  @Post('public/requests/:token')
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(submitRequestSchema)) body: SubmitRequestInput,
    @Req() req: Request,
  ): Promise<RequestReceipt> {
    const uploads = await this.requests.submit(token, body, clientIp(req));
    return { received: true, uploads };
  }

  /** Confirms one uploaded file (0022 §3). The attachment id is the capability. */
  @Public()
  @Post('public/requests/:token/attachments/:id/complete')
  completeUpload(
    @Param('token') token: string,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<{ id: string }> {
    return this.requests.completeUpload(token, id);
  }

  /** A member's proposal (0023 §3); returns the new task's id. */
  @Post('projects/:id/proposals')
  @HttpCode(HttpStatus.CREATED)
  async propose(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(proposeTaskSchema)) body: ProposeTaskInput,
  ): Promise<{ task: { id: string } }> {
    return { task: await this.requests.propose(user, projectId, body) };
  }

  /** 0023 §5: the caller's own proposals. `mine=true` is the only mode. */
  @Get('projects/:id/proposals')
  proposals(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Query(new ZodValidationPipe(listProposalsQuerySchema)) _query: ListProposalsQuery,
  ): Promise<TaskRequest[]> {
    return this.requests.mine(user.id, projectId);
  }

  @Get('projects/:id/requests')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Query(new ZodValidationPipe(listRequestsQuerySchema)) query: ListRequestsQuery,
  ): Promise<TaskRequest[]> {
    return this.requests.list(user.id, projectId, query);
  }

  @Post('requests/:id/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  async accept(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.requests.accept(user, id);
  }

  @Post('requests/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  async decline(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(declineRequestSchema)) body: DeclineRequestInput,
  ): Promise<void> {
    await this.requests.decline(user, id, body.reason ?? null);
  }

  @Put('projects/:id/intake')
  async setIntake(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Body(new ZodValidationPipe(setIntakeSchema)) body: SetIntakeInput,
  ): Promise<{ intake: ProjectIntake }> {
    return { intake: await this.requests.setIntake(user, projectId, body.enabled) };
  }

  @Post('projects/:id/intake/rotate')
  async rotate(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
  ): Promise<{ intake: ProjectIntake }> {
    return { intake: await this.requests.rotateIntake(user, projectId) };
  }
}

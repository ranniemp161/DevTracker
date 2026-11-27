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
import type {
  ProjectIntake,
  PublicIntakeInfo,
  RequestReceipt,
  TaskRequest,
  PublicSignoff,
} from '@devtrack/types';
import {
  acceptRequestSchema,
  declineRequestSchema,
  listProposalsQuerySchema,
  listRequestsQuerySchema,
  proposeTaskSchema,
  setIntakeSchema,
  approveSignoffSchema,
  requestSignoffChangesSchema,
  stopClientEmailsSchema,
  submitRequestSchema,
  type AcceptRequestInput,
  type DeclineRequestInput,
  type ListProposalsQuery,
  type ListRequestsQuery,
  type ProposeTaskInput,
  type SetIntakeInput,
  type ApproveSignoffInput,
  type RequestSignoffChangesInput,
  type StopClientEmailsInput,
  type SubmitRequestInput,
} from '@devtrack/validators';
import type { Request } from 'express';
import { CurrentUser, Public } from '../common/decorators/auth.decorators';
import { clientIp } from '../common/http/request-context';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { ClientUpdatesService } from '../client-updates/client-updates.service';
import { RequestsService } from './requests.service';
import { SignoffService } from './signoff.service';

/** Public request forms and Triage (decision record 0016). */
@Controller()
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly clientUpdates: ClientUpdatesService,
    private readonly signoff: SignoffService,
  ) {}

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

  /** 0028 §3: the client's sign-off page; 404 unless the milestone is in Client review. */
  @Public()
  @Get('public/signoff/:token')
  signoffPage(@Param('token') token: string): Promise<PublicSignoff> {
    return this.signoff.page(token);
  }

  /** 0028 §4: Approve. Tells the lead; never moves the stage. */
  @Public()
  @Post('public/signoff/:token/approve')
  @HttpCode(HttpStatus.ACCEPTED)
  async approveSignoff(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(approveSignoffSchema)) body: ApproveSignoffInput,
    @Req() req: Request,
  ): Promise<{ received: true }> {
    await this.signoff.approve(token, body, clientIp(req));
    return { received: true };
  }

  /** 0028 §4: Request changes. The note becomes a request in Triage. */
  @Public()
  @Post('public/signoff/:token/changes')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestSignoffChanges(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(requestSignoffChangesSchema)) body: RequestSignoffChangesInput,
    @Req() req: Request,
  ): Promise<{ received: true }> {
    await this.signoff.requestChanges(token, body, clientIp(req));
    return { received: true };
  }

  /** 0028 §2: "Stop emails about this request". Always 204, so tokens can't be probed. */
  @Public()
  @Post('public/client-emails/stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stopEmails(
    @Body(new ZodValidationPipe(stopClientEmailsSchema)) body: StopClientEmailsInput,
  ): Promise<void> {
    await this.clientUpdates.stop(body.token);
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
  async accept(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(acceptRequestSchema)) body: AcceptRequestInput,
  ): Promise<void> {
    await this.requests.accept(user, id, body);
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

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
import type { ProjectIntake, PublicIntakeInfo, TaskRequest } from '@devtrack/types';
import {
  listRequestsQuerySchema,
  setIntakeSchema,
  submitRequestSchema,
  type ListRequestsQuery,
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
  ): Promise<{ received: true }> {
    await this.requests.submit(token, body, clientIp(req));
    return { received: true };
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
  async decline(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string): Promise<void> {
    await this.requests.decline(user, id);
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

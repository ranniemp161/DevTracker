import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, type AvailableRepository, type GithubInstallationList } from '@devtrack/types';
import { listInstallationsQuerySchema, type ListInstallationsQuery } from '@devtrack/validators';
import type { Request, Response } from 'express';
import { AuthCookiesService } from '../../auth/auth-cookies.service';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { isUuid, UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { User } from '../../users/users.service';
import { GithubInstallationsService } from './installations.service';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** GitHub App installation (architecture §9 "GitHub", §11.2). */
@Controller('github')
export class GithubInstallationsController {
  private readonly logger = new Logger(GithubInstallationsController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly installations: GithubInstallationsService,
    private readonly cookies: AuthCookiesService,
  ) {}

  /**
   * Browser navigation from workspace settings: redirects to GitHub's install page.
   * Errors redirect back to the settings page with `?githubError=CODE`.
   */
  @Get('install')
  async install(
    @CurrentUser() user: User,
    @Query('workspaceId') workspaceId: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const id = str(workspaceId);
    try {
      if (!id || !isUuid(id)) throw AppException.notFound('Workspace not found.');
      const { installUrl, state } = await this.installations.begin(user.id, id);
      this.cookies.setGithubInstallState(res, state);
      res.redirect(HttpStatus.FOUND, installUrl);
    } catch (err) {
      this.redirectToSettings(res, id && isUuid(id) ? id : null, err);
    }
  }

  /**
   * Browser navigation for an App that is already installed on the user's GitHub account:
   * redirects to GitHub's user authorization, which returns to the install callback.
   * `installationId` (optional) pre-selects one of several installations.
   */
  @Get('connect')
  async connect(
    @CurrentUser() user: User,
    @Query('workspaceId') workspaceId: unknown,
    @Query('installationId') installationId: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const id = str(workspaceId);
    try {
      if (!id || !isUuid(id)) throw AppException.notFound('Workspace not found.');
      const { authorizeUrl, state } = await this.installations.beginConnect(
        user.id,
        id,
        str(installationId),
      );
      this.cookies.setGithubInstallState(res, state);
      res.redirect(HttpStatus.FOUND, authorizeUrl);
    } catch (err) {
      this.redirectToSettings(res, id && isUuid(id) ? id : null, err);
    }
  }

  /**
   * GitHub redirects here after installation (the App's "Callback URL", with "Request user
   * authorization during installation" enabled). Public because it is authorized by the
   * state cookie + stored flow, not the session; the flow's user is re-checked as an admin.
   */
  @Public()
  @Get('install/callback')
  async callback(
    @Query('installation_id') installationId: unknown,
    @Query('setup_action') setupAction: unknown,
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieState = this.cookies.readGithubInstallState(req);
    this.cookies.clearGithubInstallState(res);
    let workspaceId: string | null = null;
    try {
      const flow = await this.installations.consumeState(str(state), cookieState);
      workspaceId = flow.workspaceId;
      const settings = `${this.config.webOrigin}/workspaces/${workspaceId}/settings`;

      // "Connect existing installation": GitHub's user authorization returns a code only.
      if (!str(installationId) && !str(setupAction) && str(code)) {
        const result = await this.installations.completeConnect(flow, str(state)!, str(code)!);
        if (result.kind === 'installed') {
          res.redirect(HttpStatus.FOUND, `${settings}?github=installed`);
          return;
        }
        const query = new URLSearchParams({ github: 'choose' });
        for (const c of result.choices) query.append('pick', `${c.id}:${c.login}`);
        res.redirect(HttpStatus.FOUND, `${settings}?${query}`);
        return;
      }

      const outcome = await this.installations.complete(flow, {
        installationId: str(installationId),
        code: str(code),
        setupAction: str(setupAction),
      });
      res.redirect(HttpStatus.FOUND, `${settings}?github=${outcome}`);
    } catch (err) {
      this.redirectToSettings(res, workspaceId, err);
    }
  }

  @Get('installations')
  list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listInstallationsQuerySchema)) query: ListInstallationsQuery,
  ): Promise<GithubInstallationList> {
    return this.installations.list(user.id, query.workspaceId);
  }

  @Get('installations/:id/repositories')
  listRepositories(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<AvailableRepository[]> {
    return this.installations.listRepositories(user.id, id);
  }

  private redirectToSettings(res: Response, workspaceId: string | null, err: unknown) {
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    if (err instanceof AppException) {
      code = err.code;
    } else {
      this.logger.error(
        'GitHub App installation flow failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
    const path = workspaceId ? `/workspaces/${workspaceId}/settings` : '/';
    res.redirect(
      HttpStatus.FOUND,
      `${this.config.webOrigin}${path}?githubError=${encodeURIComponent(code)}`,
    );
  }
}

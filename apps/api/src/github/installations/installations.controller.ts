import {
  Controller,
  Body,
  Delete,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Put,
  HttpCode,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, type AvailableRepository, type GithubConnectionList } from '@devtrack/types';
import {
  listInstallationsQuerySchema,
  type ListInstallationsQuery,
  connectGithubInstallationSchema,
  type ConnectGithubInstallationInput,
  updateGithubRepositoryAccessSchema,
  type UpdateGithubRepositoryAccessInput,
} from '@devtrack/validators';
import type { Request, Response } from 'express';
import { AuthCookiesService } from '../../auth/auth-cookies.service';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { isUuid, UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import type { User } from '../../users/users.service';
import { GithubAuthorization } from '../authorization/github-authorization.service';
import { GithubInstallationsService } from './installations.service';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/**
 * GitHub App installation and workspace connections (architecture §9 "GitHub", §11.2).
 * Connection routes are served under `/github/connections` and, until #121, also under the
 * deprecated `/github/installations`.
 */
@Controller('github')
export class GithubInstallationsController {
  private readonly logger = new Logger(GithubInstallationsController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly installations: GithubInstallationsService,
    private readonly authorization: GithubAuthorization,
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
    @Query('mode') mode: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const id = str(workspaceId);
    try {
      if (!id || !isUuid(id)) throw AppException.notFound('Workspace not found.');
      const { installUrl, state } = await this.authorization.start(
        user.id,
        id,
        mode === 'connect' ? 'connect' : 'install',
      );
      this.cookies.setGithubInstallState(res, state);
      res.redirect(HttpStatus.FOUND, installUrl);
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
      const flow = await this.authorization.consume(str(state), cookieState);
      workspaceId = flow.workspaceId;
      if (flow.mode === 'connect') {
        const selectionState = await this.authorization.prepareChoices(flow, str(code));
        this.cookies.setGithubInstallState(res, selectionState);
        res.redirect(
          HttpStatus.FOUND,
          `${this.config.webOrigin}/workspaces/${workspaceId}/settings?github=choose`,
        );
        return;
      }
      const verified = await this.authorization.verifyInstall(flow, {
        installationId: str(installationId),
        code: str(code),
        setupAction: str(setupAction),
      });
      if (verified !== 'requested') await this.installations.connect(verified);
      const outcome = verified === 'requested' ? 'requested' : 'installed';
      res.redirect(
        HttpStatus.FOUND,
        `${this.config.webOrigin}/workspaces/${workspaceId}/settings?github=${outcome}`,
      );
    } catch (err) {
      this.redirectToSettings(res, workspaceId, err);
    }
  }

  @Get(['connections', 'installations'])
  list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listInstallationsQuerySchema)) query: ListInstallationsQuery,
  ): Promise<GithubConnectionList> {
    return this.installations.list(user.id, query.workspaceId);
  }

  @Get(['connections/:id/repositories', 'installations/:id/repositories'])
  listRepositories(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
  ): Promise<AvailableRepository[]> {
    return this.installations.listRepositories(user.id, id);
  }

  @Get('available-installations')
  available(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(listInstallationsQuerySchema)) query: ListInstallationsQuery,
    @Req() req: Request,
  ) {
    return this.authorization.choices(
      user.id,
      query.workspaceId,
      this.cookies.readGithubInstallState(req),
    );
  }

  @Post('connections')
  async connect(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(connectGithubInstallationSchema))
    input: ConnectGithubInstallationInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const verified = await this.authorization.verifyChoice(
      user.id,
      input.workspaceId,
      input.githubInstallationId,
      this.cookies.readGithubInstallState(req),
    );
    await this.installations.connect(verified);
    this.cookies.clearGithubInstallState(res);
    return { connected: true };
  }

  @Get(['connections/:id/repository-access', 'installations/:id/repository-access'])
  repositoryAccess(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string) {
    return this.installations.repositoryAccess(user.id, id);
  }

  @Put(['connections/:id/repository-access', 'installations/:id/repository-access'])
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateRepositoryAccess(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(updateGithubRepositoryAccessSchema))
    input: UpdateGithubRepositoryAccessInput,
  ) {
    await this.installations.updateRepositoryAccess(user.id, id, input.githubRepositoryIds);
  }

  @Delete(['connections/:id', 'installations/:id'])
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@CurrentUser() user: User, @Param('id', UuidParamPipe) id: string) {
    await this.installations.disconnectWorkspace(user.id, id);
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

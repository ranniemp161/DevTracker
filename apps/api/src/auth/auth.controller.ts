import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ErrorCode, type PublicUser } from '@devtrack/types';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  safeRedirectPath,
  verifyEmailSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from '@devtrack/validators';
import type { Request, Response } from 'express';
import { AllowUnverified, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { AppException } from '../common/errors/app.exception';
import { clientIp } from '../common/http/request-context';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import { toPublicUser, type User } from '../users/users.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { GithubOAuthService } from './github/github-oauth.service';
import { PasswordResetService } from './password-reset.service';
import { SessionsService } from './sessions.service';

interface UserResponse {
  user: PublicUser;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly cookies: AuthCookiesService,
    private readonly verification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
    private readonly github: GithubOAuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponse> {
    await this.rateLimit.consume(RATE_LIMITS.registerPerIp, clientIp(req));
    const grant = await this.auth.register(body);
    await this.startSession(req, res, grant.token, grant.expiresAt);
    return { user: toPublicUser(grant.user) };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserResponse> {
    const ip = clientIp(req);
    await this.rateLimit.consume(RATE_LIMITS.loginPerIp, ip);
    await this.rateLimit.consume(RATE_LIMITS.loginPerIpAndEmail, `${ip}|${body.email}`);
    const grant = await this.auth.login(body);
    await this.startSession(req, res, grant.token, grant.expiresAt);
    return { user: toPublicUser(grant.user) };
  }

  /** Public so a stale/expired cookie can always be cleared. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = this.cookies.readSession(req);
    if (token) await this.sessions.revoke(token);
    this.cookies.clearSession(res);
  }

  @AllowUnverified()
  @Get('me')
  me(@CurrentUser() user: User): UserResponse {
    return { user: toPublicUser(user) };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput,
    @Req() req: Request,
  ): Promise<UserResponse> {
    await this.rateLimit.consume(RATE_LIMITS.tokenRedeemPerIp, clientIp(req));
    const user = await this.verification.verify(body.token);
    return { user: toPublicUser(user) };
  }

  /** M1 addition: needed so an expired or lost verification link is not a dead end. */
  @AllowUnverified()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@CurrentUser() user: User): Promise<{ sent: true }> {
    if (user.emailVerifiedAt) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.EMAIL_ALREADY_VERIFIED,
        'Your email is already verified.',
      );
    }
    await this.rateLimit.consume(RATE_LIMITS.resendVerificationPerUser, user.id);
    await this.verification.resend(user);
    return { sent: true };
  }

  /** Always 202 with the same body, whether or not the email is registered. */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: Request,
  ): Promise<{ sent: true }> {
    await this.rateLimit.consume(RATE_LIMITS.forgotPasswordPerIp, clientIp(req));
    await this.rateLimit.consume(RATE_LIMITS.forgotPasswordPerEmail, body.email);
    await this.passwordReset.request(body.email);
    return { sent: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ reset: true }> {
    await this.rateLimit.consume(RATE_LIMITS.tokenRedeemPerIp, clientIp(req));
    await this.passwordReset.reset(body.token, body.password);
    // Every session (including this browser's) was revoked; make the user sign in again.
    this.cookies.clearSession(res);
    return { reset: true };
  }

  /** Browser navigation: redirects to GitHub. Errors redirect back to the login page. */
  @Public()
  @Get('github')
  async githubStart(@Query('redirectTo') redirectTo: unknown, @Res() res: Response): Promise<void> {
    try {
      const { authorizeUrl, state } = await this.github.begin(safeRedirectPath(redirectTo));
      this.cookies.setOAuthState(res, state);
      res.redirect(HttpStatus.FOUND, authorizeUrl);
    } catch (err) {
      this.redirectToLoginWithError(res, err);
    }
  }

  @Public()
  @Get('github/callback')
  async githubCallback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') providerError: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieState = this.cookies.readOAuthState(req);
    this.cookies.clearOAuthState(res);
    try {
      const { user, redirectTo } = await this.github.complete({
        code: typeof code === 'string' ? code : undefined,
        state: typeof state === 'string' ? state : undefined,
        providerError: typeof providerError === 'string' ? providerError : undefined,
        cookieState,
      });
      const session = await this.sessions.create(user.id);
      await this.startSession(req, res, session.token, session.expiresAt);
      res.redirect(HttpStatus.FOUND, `${this.config.webOrigin}${safeRedirectPath(redirectTo)}`);
    } catch (err) {
      this.redirectToLoginWithError(res, err);
    }
  }

  /** Revokes any session this browser already had (no session fixation), then sets the new one. */
  private async startSession(req: Request, res: Response, token: string, expiresAt: Date) {
    const previous = this.cookies.readSession(req);
    if (previous) await this.sessions.revoke(previous);
    this.cookies.setSession(res, token, expiresAt);
  }

  private redirectToLoginWithError(res: Response, err: unknown) {
    let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
    if (err instanceof AppException) {
      code = err.code;
    } else {
      this.logger.error('GitHub OAuth flow failed', err instanceof Error ? err.stack : String(err));
    }
    res.redirect(
      HttpStatus.FOUND,
      `${this.config.webOrigin}/login?error=${encodeURIComponent(code)}`,
    );
  }
}

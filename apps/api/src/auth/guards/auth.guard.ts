import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_UNVERIFIED, IS_PUBLIC } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { emailNotVerified } from '../auth.errors';
import { AuthCookiesService } from '../auth-cookies.service';
import { SessionsService } from '../sessions.service';

/**
 * Global guard: every HTTP route requires a valid session unless marked `@Public()`,
 * and a verified email unless marked `@AllowUnverified()`. Secure by default.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly cookies: AuthCookiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // real-time gateway authenticates itself (M7)
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = this.cookies.readSession(req);
    const auth = token ? await this.sessions.authenticate(token) : null;
    if (!auth) throw AppException.unauthenticated();
    req.auth = auth;

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED, targets);
    if (!allowUnverified && !auth.user.emailVerifiedAt) throw emailNotVerified();
    return true;
  }
}

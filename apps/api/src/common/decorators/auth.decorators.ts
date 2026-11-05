import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Session } from '../../auth/sessions.service';
import type { User } from '../../users/users.service';

export const IS_PUBLIC = 'devtrack:isPublic';
export const ALLOW_UNVERIFIED = 'devtrack:allowUnverified';

/** Route needs no session. Every other route requires authentication by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route is available to signed-in users whose email is not yet verified.
 * By default, authenticated routes require a verified email (architecture §5).
 */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED, true);

/** The authenticated user. Only valid on non-public routes. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new Error('CurrentUser used on a route without AuthGuard authentication');
  return req.auth.user;
});

/** The current session row. Only valid on non-public routes. */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): Session => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.auth) throw new Error('CurrentSession used on a route without AuthGuard authentication');
  return req.auth.session;
});

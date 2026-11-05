import { Module } from '@nestjs/common';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { UsersModule } from '../users/users.module';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { GithubOAuthClient } from './github/github-oauth.client';
import { GithubOAuthService } from './github/github-oauth.service';
import { AuthGuard } from './guards/auth.guard';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [UsersModule, RateLimitModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookiesService,
    AuthGuard,
    EmailVerificationService,
    GithubOAuthClient,
    GithubOAuthService,
    PasswordResetService,
    PasswordService,
    SessionsService,
  ],
  exports: [AuthGuard, AuthCookiesService, SessionsService],
})
export class AuthModule {}

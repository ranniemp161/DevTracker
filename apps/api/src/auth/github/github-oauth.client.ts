import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@devtrack/types';
import { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';

export interface GithubProfile {
  /** Stable numeric GitHub user ID. Logins can be renamed; IDs cannot. */
  id: number;
  login: string;
  avatarUrl: string | null;
}

export interface ExchangeCodeParams {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

const tokenResponse = z.union([
  z.object({ access_token: z.string().min(1), token_type: z.string() }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);
const userResponse = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  avatar_url: z.string().nullable().optional(),
});
const emailsResponse = z.array(
  z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }),
);

const TIMEOUT_MS = 10_000;
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'DevTrack',
};

const providerError = () =>
  new AppException(
    HttpStatus.BAD_GATEWAY,
    ErrorCode.OAUTH_PROVIDER_ERROR,
    'GitHub sign-in failed. Please try again.',
  );

/**
 * Thin HTTP client for GitHub's OAuth web flow (login only — not the GitHub App).
 * The access token is used for these calls and then discarded; it is never stored.
 * Tests replace this provider with a fake.
 */
@Injectable()
export class GithubOAuthClient {
  async exchangeCode(params: ExchangeCodeParams): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'DevTrack',
      },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        redirect_uri: params.redirectUri,
        code_verifier: params.codeVerifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!res?.ok) throw providerError();
    const parsed = tokenResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success || !('access_token' in parsed.data)) throw providerError();
    return parsed.data.access_token;
  }

  async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const data = userResponse.safeParse(await this.get('https://api.github.com/user', accessToken));
    if (!data.success) throw providerError();
    const avatar = data.data.avatar_url;
    return {
      id: data.data.id,
      login: data.data.login,
      avatarUrl: avatar && avatar.startsWith('https://') ? avatar : null,
    };
  }

  /** The primary email, only if GitHub has verified it. Requires the `user:email` scope. */
  async fetchPrimaryVerifiedEmail(accessToken: string): Promise<string | null> {
    const data = emailsResponse.safeParse(
      await this.get('https://api.github.com/user/emails', accessToken),
    );
    if (!data.success) throw providerError();
    const primary = data.data.find((e) => e.primary && e.verified);
    return primary ? primary.email.trim().toLowerCase() : null;
  }

  private async get(url: string, accessToken: string): Promise<unknown> {
    const res = await fetch(url, {
      headers: { ...API_HEADERS, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!res?.ok) throw providerError();
    return res.json().catch(() => null);
  }
}

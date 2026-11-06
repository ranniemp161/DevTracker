import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@devtrack/types';
import { createSign } from 'node:crypto';
import { z } from 'zod';
import { AppException } from '../common/errors/app.exception';
import { APP_CONFIG, type AppConfig, type GithubAppConfig } from '../config/app-config';
import { pullRequestSchema, type PullRequestPayload } from './webhooks/payloads';

/** What DevTrack reads about a repository (architecture §11.3). */
export interface GithubRepo {
  id: number;
  fullName: string;
  ownerLogin: string;
  defaultBranch: string;
  visibility: string;
}

export interface GithubInstallationInfo {
  id: number;
  accountLogin: string;
  accountType: string;
  suspendedAt: Date | null;
}

/** GitHub refused to mint an installation token: the app was uninstalled or suspended. */
export class GithubInstallationUnavailableError extends Error {
  constructor(readonly status: 'SUSPENDED' | 'REMOVED') {
    super(`GitHub installation is ${status.toLowerCase()}`);
  }
}

/**
 * The response type of the global `fetch`, derived rather than named: under some compiler settings
 * (e.g. Vercel's NestJS build) the global name `Response` resolves to an empty placeholder type.
 */
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
/** Upper bound on repositories listed per installation (10 pages of 100). */
export const MAX_LISTED_REPOSITORIES = 1000;
/** Re-mint installation tokens this long before GitHub's one-hour expiry. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'DevTrack',
};

const accountSchema = z.object({ login: z.string().min(1), type: z.string().min(1) }).nullable();
const repoSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
  default_branch: z.string().min(1).nullable().optional(),
  private: z.boolean(),
  visibility: z.string().optional(),
});
const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.string() });
const userTokenSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
]);
const userInstallationsSchema = z.object({
  total_count: z.number().int(),
  installations: z.array(
    z.object({
      id: z.number().int().positive(),
      account: accountSchema,
      suspended_at: z.string().nullable().optional(),
    }),
  ),
});
const installationReposSchema = z.object({
  total_count: z.number().int(),
  repositories: z.array(repoSchema),
});

const toRepo = (r: z.infer<typeof repoSchema>): GithubRepo => ({
  id: r.id,
  fullName: r.full_name,
  ownerLogin: r.owner.login,
  defaultBranch: r.default_branch ?? 'main',
  visibility: r.visibility ?? (r.private ? 'private' : 'public'),
});

export const githubApiError = () =>
  new AppException(
    HttpStatus.BAD_GATEWAY,
    ErrorCode.GITHUB_API_ERROR,
    'GitHub could not be reached. Please try again.',
  );

const notConfigured = () =>
  new AppException(
    HttpStatus.SERVICE_UNAVAILABLE,
    ErrorCode.GITHUB_APP_NOT_CONFIGURED,
    'The GitHub App is not configured on this server.',
  );

/**
 * Signs a GitHub App JWT (RS256). `iat` is backdated 60s for clock drift and `exp` stays under
 * GitHub's 10-minute limit.
 */
export function createAppJwt(appId: string, privateKey: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000) - 60;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat, exp: iat + 9 * 60, iss: appId })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

/**
 * HTTP client for the GitHub App (repository access). Separate from `GithubOAuthClient`, which
 * only signs people in. Installation tokens are minted on demand and cached in memory only;
 * no GitHub credential is ever written to the database (decision record 0005).
 * Tests replace this provider with a fake.
 */
@Injectable()
export class GithubAppClient {
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private app(): GithubAppConfig {
    if (!this.config.githubApp) throw notConfigured();
    return this.config.githubApp;
  }

  /** Exchanges the `code` from the installation callback for a short-lived user token. */
  async exchangeInstallCode(code: string): Promise<string | null> {
    const app = this.app();
    const res = await this.fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code }),
    });
    if (!res.ok) throw githubApiError();
    const parsed = userTokenSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw githubApiError();
    // An `error` (e.g. bad_verification_code) means the code was forged, reused or expired.
    return 'access_token' in parsed.data ? parsed.data.access_token : null;
  }

  /**
   * The installation, if the user behind `userToken` can access it on GitHub. This is the
   * proof that the person who completed the installation controls it (decision 0005).
   */
  async findUserInstallation(
    userToken: string,
    installationId: number,
  ): Promise<GithubInstallationInfo | null> {
    for (let page = 1; page <= 10; page++) {
      const res = await this.fetch(`${API}/user/installations?per_page=100&page=${page}`, {
        headers: { ...API_HEADERS, Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) throw githubApiError();
      const parsed = userInstallationsSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw githubApiError();
      const match = parsed.data.installations.find((i) => i.id === installationId);
      if (match) {
        return {
          id: match.id,
          accountLogin: match.account?.login ?? 'unknown',
          accountType: match.account?.type ?? 'Unknown',
          suspendedAt: match.suspended_at ? new Date(match.suspended_at) : null,
        };
      }
      if (page * 100 >= parsed.data.total_count) break;
    }
    return null;
  }

  /** Best effort: the user token is not needed after verification. */
  async revokeUserToken(userToken: string): Promise<void> {
    const app = this.app();
    const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64');
    await this.fetch(`${API}/applications/${encodeURIComponent(app.clientId)}/token`, {
      method: 'DELETE',
      headers: { ...API_HEADERS, Authorization: `Basic ${basic}` },
      body: JSON.stringify({ access_token: userToken }),
    }).catch(() => undefined);
  }

  /** Repositories the installation can access, up to `MAX_LISTED_REPOSITORIES`. */
  async listInstallationRepositories(installationId: number): Promise<GithubRepo[]> {
    const repos: GithubRepo[] = [];
    for (let page = 1; page * 100 <= MAX_LISTED_REPOSITORIES; page++) {
      const res = await this.installationGet(
        installationId,
        `/installation/repositories?per_page=100&page=${page}`,
      );
      if (!res.ok) throw githubApiError();
      const parsed = installationReposSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw githubApiError();
      repos.push(...parsed.data.repositories.map(toRepo));
      if (page * 100 >= parsed.data.total_count) break;
    }
    return repos;
  }

  /** The repository if the installation can access it, otherwise null. */
  async getRepository(
    installationId: number,
    githubRepositoryId: number,
  ): Promise<GithubRepo | null> {
    const res = await this.installationGet(installationId, `/repositories/${githubRepositoryId}`);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw githubApiError();
    const parsed = repoSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw githubApiError();
    return toRepo(parsed.data);
  }

  /**
   * The repository's most recently updated pull requests (any state), up to `limit` (max 100),
   * in the same shape as webhook payloads. Invalid entries are skipped.
   */
  async listPullRequests(
    installationId: number,
    githubRepositoryId: number,
    limit = 100,
  ): Promise<PullRequestPayload[]> {
    const perPage = Math.min(Math.max(limit, 1), 100);
    const res = await this.installationGet(
      installationId,
      `/repositories/${githubRepositoryId}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}`,
    );
    if (res.status === 404 || res.status === 403) return [];
    if (!res.ok) throw githubApiError();
    const body: unknown = await res.json().catch(() => null);
    if (!Array.isArray(body)) throw githubApiError();
    return body.flatMap((item) => {
      const parsed = pullRequestSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private async installationGet(installationId: number, path: string): Promise<FetchResponse> {
    const token = await this.installationToken(installationId);
    const res = await this.fetch(`${API}${path}`, {
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    });
    // A revoked token (e.g. uninstalled since it was cached): forget it so the next call re-mints.
    if (res.status === 401) {
      this.tokens.delete(installationId);
      throw githubApiError();
    }
    return res;
  }

  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;

    const app = this.app();
    const res = await this.fetch(`${API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        ...API_HEADERS,
        Authorization: `Bearer ${createAppJwt(app.appId, app.privateKey)}`,
      },
    });
    if (res.status === 404) throw new GithubInstallationUnavailableError('REMOVED');
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (body?.message?.toLowerCase().includes('suspended')) {
        throw new GithubInstallationUnavailableError('SUSPENDED');
      }
      throw githubApiError();
    }
    if (!res.ok) throw githubApiError();
    const parsed = tokenSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw githubApiError();
    this.tokens.set(installationId, {
      token: parsed.data.token,
      expiresAt: new Date(parsed.data.expires_at).getTime(),
    });
    return parsed.data.token;
  }

  private async fetch(url: string, init: RequestInit): Promise<FetchResponse> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(
      () => null,
    );
    if (!res) throw githubApiError();
    return res;
  }
}

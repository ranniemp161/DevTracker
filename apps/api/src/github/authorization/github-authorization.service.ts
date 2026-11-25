import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, githubInstallStates, lt, type Database } from '@devtrack/database';
import { ErrorCode, type AvailableGithubInstallation } from '@devtrack/types';
import { GITHUB_INSTALL_STATE_TTL_MS } from '../../auth/auth-cookies.service';
import { generateToken, hashToken, safeEqual } from '../../common/crypto/tokens';
import { AppException } from '../../common/errors/app.exception';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import { notAuthorized } from '../access/repository-access.service';
import { GithubAppClient, type GithubInstallationInfo } from '../github-app.client';

/** How long verified installations stay on offer after "Connect existing installation". */
const CHOICE_WINDOW_MS = 10 * 60 * 1000;

declare const verified: unique symbol;

/**
 * Proof that GitHub confirmed `userId` can manage this installation, made while they were an
 * Admin/Owner of `workspaceId`. Saving a connection requires it. Only GithubAuthorization can
 * create one: the brand is private to this file.
 */
export interface VerifiedInstallation {
  readonly [verified]: true;
  readonly installation: GithubInstallationInfo;
  /** Repositories verified with the user's own GitHub token: the candidates they may grant. */
  readonly repositoryIds: readonly number[];
  readonly userId: string;
  readonly workspaceId: string;
}

const issue = (proof: Omit<VerifiedInstallation, typeof verified>) =>
  Object.freeze({ ...proof }) as VerifiedInstallation;

/** A consumed sign-in state: the flow GitHub's redirect belongs to. */
export type SignInFlow = Readonly<typeof githubInstallStates.$inferSelect>;

const stateInvalid = () =>
  new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.GITHUB_INSTALL_STATE_INVALID,
    'The GitHub installation session expired or is invalid. Start the installation again from DevTrack.',
  );

/**
 * The browser sign-in flow with GitHub (architecture §11.2, decision records 0005 and 0010).
 * A connection needs three proofs:
 * 1. the browser that returns from GitHub is the one that started the flow (state cookie);
 * 2. the DevTrack user who started it is still an Admin/Owner of the workspace;
 * 3. the GitHub user who completed it can access the installation on GitHub (a user token
 *    that is revoked right after and never stored), so a forged `installation_id` cannot
 *    attach someone else's repositories.
 *
 * It owns the `github_install_states` table: hashed, single-use, browser-bound states, the
 * ten-minute choice window, and the cleanup of expired rows.
 */
@Injectable()
export class GithubAuthorization {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: WorkspaceAccessService,
    private readonly client: GithubAppClient,
  ) {}

  /** Returns GitHub's URL and the raw state for the browser-binding cookie. */
  async start(
    userId: string,
    workspaceId: string,
    mode: 'install' | 'connect' = 'install',
  ): Promise<{ installUrl: string; state: string }> {
    await this.access.require(userId, workspaceId, 'ADMIN');
    const app = this.config.githubApp;
    if (!app) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.GITHUB_APP_NOT_CONFIGURED,
        'The GitHub App is not configured on this server.',
      );
    }

    // Opportunistic cleanup of abandoned flows (indexed on expires_at).
    await this.db.delete(githubInstallStates).where(lt(githubInstallStates.expiresAt, new Date()));

    const state = generateToken();
    await this.db.insert(githubInstallStates).values({
      mode,
      stateHash: hashToken(state),
      userId,
      workspaceId,
      expiresAt: new Date(Date.now() + GITHUB_INSTALL_STATE_TTL_MS),
    });
    const url = new URL(
      mode === 'connect'
        ? 'https://github.com/login/oauth/authorize'
        : `https://github.com/apps/${app.slug}/installations/new`,
    );
    if (mode === 'connect') {
      url.searchParams.set('client_id', app.clientId);
      url.searchParams.set('redirect_uri', this.callbackUrl());
    }
    url.searchParams.set('state', state);
    return { installUrl: url.toString(), state };
  }

  /**
   * Validates and consumes the state GitHub handed back (single use). It must equal the
   * browser's cookie and match an unexpired row.
   */
  async consume(state?: string, cookieState?: string): Promise<SignInFlow> {
    if (!state || !cookieState || !safeEqual(state, cookieState)) throw stateInvalid();
    const [row] = await this.db
      .delete(githubInstallStates)
      .where(eq(githubInstallStates.stateHash, hashToken(state)))
      .returning();
    if (!row || row.mode === 'choose' || row.expiresAt.getTime() <= Date.now())
      throw stateInvalid();
    return row;
  }

  /**
   * "Install on GitHub": verifies the installation GitHub redirected back with. Returns
   * `requested` when an organization member asked an owner to approve the app (nothing is
   * installed yet).
   */
  async verifyInstall(
    flow: SignInFlow,
    params: { installationId?: string; code?: string; setupAction?: string },
  ): Promise<VerifiedInstallation | 'requested'> {
    await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    if (flow.mode !== 'install') throw notAuthorized();
    if (params.setupAction === 'request') return 'requested';

    const githubInstallationId =
      params.installationId && /^\d{1,15}$/.test(params.installationId)
        ? Number(params.installationId)
        : null;
    if (!githubInstallationId || !params.code) throw notAuthorized();

    const userToken = await this.client.exchangeInstallCode(params.code);
    if (!userToken) throw notAuthorized();
    let info: GithubInstallationInfo | null;
    let repositoryIds: number[] = [];
    try {
      info = await this.client.findUserInstallation(userToken, githubInstallationId);
      if (info)
        repositoryIds = (
          await this.client.listUserRepositories(userToken, githubInstallationId)
        ).map((r) => r.id);
    } finally {
      await this.client.revokeUserToken(userToken);
    }
    if (!info) throw notAuthorized();

    // The role is checked again: GitHub may have taken a while.
    await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    // Installation access alone is insufficient: only repos readable by this user may be delegated.
    return issue({
      installation: info,
      repositoryIds,
      userId: flow.userId,
      workspaceId: flow.workspaceId,
    });
  }

  /**
   * "Connect existing installation": lists the installations the GitHub user can manage and
   * stores them as choices for ten minutes. Returns the state for the choice-window cookie.
   */
  async prepareChoices(flow: SignInFlow, code?: string): Promise<string> {
    await this.access.require(flow.userId, flow.workspaceId, 'ADMIN');
    if (flow.mode !== 'connect' || !code) throw notAuthorized();
    const token = await this.client.exchangeInstallCode(code, this.callbackUrl());
    if (!token) throw notAuthorized();
    const choices: NonNullable<SignInFlow['verifiedInstallations']> = [];
    try {
      const installations = await this.client.listUserInstallations(token);
      for (const info of installations.filter((i) => !i.suspendedAt)) {
        const repos = await this.client.listUserRepositories(token, info.id);
        choices.push({ ...info, suspendedAt: null, repositoryIds: repos.map((r) => r.id) });
      }
    } finally {
      await this.client.revokeUserToken(token);
    }
    const state = generateToken();
    await this.db.insert(githubInstallStates).values({
      userId: flow.userId,
      workspaceId: flow.workspaceId,
      mode: 'choose',
      stateHash: hashToken(state),
      verifiedInstallations: choices,
      expiresAt: new Date(Date.now() + CHOICE_WINDOW_MS),
    });
    return state;
  }

  /** The verified installations on offer, only to the same user, workspace and browser. */
  async choices(
    userId: string,
    workspaceId: string,
    cookie?: string,
  ): Promise<AvailableGithubInstallation[]> {
    const flow = await this.choiceWindow(userId, workspaceId, cookie);
    return (flow?.verifiedInstallations ?? []).map((i) => ({
      githubInstallationId: i.id,
      accountLogin: i.accountLogin,
      accountType: i.accountType,
    }));
  }

  /** Verifies one of the offered installations. The window closes once it is used. */
  async verifyChoice(
    userId: string,
    workspaceId: string,
    githubInstallationId: number,
    cookie?: string,
  ): Promise<VerifiedInstallation> {
    const flow = await this.choiceWindow(userId, workspaceId, cookie);
    const info = flow?.verifiedInstallations?.find((i) => i.id === githubInstallationId);
    if (!flow || !info) throw notAuthorized();
    // Consume once before issuing the proof; a replay cannot reuse it for another connection.
    const consumed = await this.db
      .delete(githubInstallStates)
      .where(eq(githubInstallStates.id, flow.id))
      .returning();
    if (!consumed.length) throw stateInvalid();
    const { repositoryIds, ...installation } = info;
    return issue({
      installation: {
        ...installation,
        suspendedAt: installation.suspendedAt ? new Date(installation.suspendedAt) : null,
      },
      repositoryIds,
      userId,
      workspaceId,
    });
  }

  private async choiceWindow(userId: string, workspaceId: string, cookie?: string) {
    await this.access.require(userId, workspaceId, 'ADMIN');
    if (!cookie) return null;
    const [flow] = await this.db
      .select()
      .from(githubInstallStates)
      .where(
        and(
          eq(githubInstallStates.stateHash, hashToken(cookie)),
          eq(githubInstallStates.userId, userId),
          eq(githubInstallStates.workspaceId, workspaceId),
          eq(githubInstallStates.mode, 'choose'),
        ),
      );
    return flow && flow.expiresAt.getTime() > Date.now() ? flow : null;
  }

  private callbackUrl() {
    return `${this.config.webOrigin}/api/v1/github/install/callback`;
  }
}

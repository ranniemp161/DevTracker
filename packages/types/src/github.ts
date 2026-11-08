import type { UserRef } from './project.js';

/** Decision record 0005. REMOVED and SUSPENDED installations cannot be used to connect repositories. */
export const GITHUB_INSTALLATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'] as const;
export type GithubInstallationStatus = (typeof GITHUB_INSTALLATION_STATUSES)[number];

/** A workspace connection to a GitHub App installation. `id` is the scoped connection ID. */
export interface GithubInstallation {
  id: string;
  workspaceId: string;
  githubInstallationId: number;
  /** The GitHub user or organization the app is installed on. */
  accountLogin: string;
  accountType: string;
  status: GithubInstallationStatus;
  installedBy: UserRef | null;
  installedAt: string;
  suspendedAt: string | null;
}

/** Verified, short-lived choices from the current browser's GitHub authorization. */
export interface AvailableGithubInstallation {
  githubInstallationId: number;
  accountLogin: string;
  accountType: string;
}

export interface GithubRepositoryAccess extends AvailableRepository {
  allowed: boolean;
}

/** `GET /github/installations?workspaceId=` */
export interface GithubInstallationList {
  /** False when the server has no GitHub App credentials; installing is then unavailable. */
  appConfigured: boolean;
  installations: GithubInstallation[];
}

/** A repository the installation can access, read live from GitHub (§11.3). */
export interface AvailableRepository {
  /** Stable GitHub numeric ID: use this to connect, not the name. */
  githubRepositoryId: number;
  fullName: string;
  ownerLogin: string;
  defaultBranch: string;
  visibility: string;
  /** Projects in this workspace the repository is already connected to. */
  connectedProjectIds: string[];
}

/** A repository connected to a project. */
export interface ConnectedRepository {
  /** DevTrack repository ID (used by `DELETE /projects/:id/repositories/:repoId`). */
  id: string;
  installationId: string;
  installationStatus: GithubInstallationStatus;
  githubRepositoryId: number;
  fullName: string;
  ownerLogin: string;
  defaultBranch: string;
  visibility: string;
  url: string;
  connectedBy: UserRef | null;
  connectedAt: string;
}

/** `merged` is derived: GitHub reports merged PRs as `closed` with `merged_at`. */
export type PullRequestState = 'open' | 'closed' | 'merged';

/** A pull request of a connected repository (architecture §11.9). */
export interface PullRequest {
  id: string;
  repository: { id: string; fullName: string };
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  headBranch: string;
  baseBranch: string;
  state: PullRequestState;
  isDraft: boolean;
  openedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
}

export type TaskLinkSource = 'MANUAL' | 'AUTO';

/** A pull request linked to a task (§11.10). */
export interface LinkedPullRequest extends PullRequest {
  link: {
    /** AUTO: the task key was found in the branch name or title (decision record 0006). */
    source: TaskLinkSource;
    linkedBy: UserRef | null;
    linkedAt: string;
  };
}

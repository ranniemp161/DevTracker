import type { UserRef } from './project.js';

/** Decision record 0005. REMOVED and SUSPENDED installations cannot be used to connect repositories. */
export const GITHUB_INSTALLATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'] as const;
export type GithubInstallationStatus = (typeof GITHUB_INSTALLATION_STATUSES)[number];

/** A GitHub App installation bound to a workspace (architecture §11.2). */
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

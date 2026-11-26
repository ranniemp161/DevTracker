import type { WorkspaceSummary } from './workspace.js';

/** The user representation returned by the API. Never includes secrets or hashes. */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  /** Display only (0023 §7). */
  jobTitle: string | null;
  emailVerified: boolean;
  createdAt: string;
}

/** `GET /auth/me`. Workspaces are included once the email is verified, saving a request. */
export interface MeResponse {
  user: PublicUser;
  workspaces?: WorkspaceSummary[];
}

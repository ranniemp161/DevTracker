/** The user representation returned by the API. Never includes secrets or hashes. */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
}

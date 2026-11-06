import { z } from 'zod';

export const listInstallationsQuerySchema = z.object({
  workspaceId: z.uuid({ error: 'Invalid workspace id.' }),
});
export type ListInstallationsQuery = z.infer<typeof listInstallationsQuerySchema>;

/** `POST /projects/:id/repositories`. Repositories are identified by GitHub's stable numeric ID. */
export const connectRepositorySchema = z.object({
  installationId: z.uuid({ error: 'Choose a GitHub installation.' }),
  githubRepositoryId: z
    .number({ error: 'Choose a repository.' })
    .int({ error: 'Choose a repository.' })
    .positive({ error: 'Choose a repository.' })
    .max(Number.MAX_SAFE_INTEGER),
});
export type ConnectRepositoryInput = z.infer<typeof connectRepositorySchema>;

/** `POST /tasks/:id/pull-requests`. */
export const linkPullRequestSchema = z.object({
  pullRequestId: z.uuid({ error: 'Choose a pull request.' }),
});
export type LinkPullRequestInput = z.infer<typeof linkPullRequestSchema>;

/** `GET /repositories/:id/pull-requests`. */
export const listPullRequestsQuerySchema = z.object({
  state: z.enum(['open', 'closed', 'merged', 'all']).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListPullRequestsQuery = z.infer<typeof listPullRequestsQuerySchema>;

/** `GET /projects/:id/github/activity`. */
export const listGithubActivityQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListGithubActivityQuery = z.infer<typeof listGithubActivityQuerySchema>;

/**
 * Task keys (`DEV-104`) in a branch name or pull request title, upper-cased, unique, at most
 * 10. Matching is case-insensitive because branch names are usually lower case
 * (`feature/dev-104-login`). Used for automatic linking (decision record 0006).
 */
export function extractTaskKeys(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  const pattern = /(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})(?![0-9])/g;
  for (const text of texts) {
    for (const m of (text ?? '').matchAll(pattern)) {
      const key = `${m[1]!.toUpperCase()}-${m[2]}`;
      if (!found.includes(key)) found.push(key);
      if (found.length >= 10) return found;
    }
  }
  return found;
}

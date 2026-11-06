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

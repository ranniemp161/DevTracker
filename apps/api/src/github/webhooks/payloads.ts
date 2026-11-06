import { z } from 'zod';

/**
 * The parts of GitHub webhook payloads DevTrack reads (architecture §11.6). Unknown fields are
 * stripped. A payload that does not match is recorded as IGNORED, not retried.
 */

const id = z.number().int().positive();
/** Rendered as links in the website, so only https URLs are accepted. */
const httpsUrl = z.string().startsWith('https://');
const login = z.object({ login: z.string().min(1) });

const installationRef = z.object({ id });
const repositoryRef = z.object({ id, full_name: z.string().min(1) });
export const senderSchema = z
  .object({ id, login: z.string().min(1), type: z.string().optional() })
  .optional();

export const pullRequestSchema = z.object({
  id,
  number: z.number().int().positive(),
  title: z.string(),
  html_url: httpsUrl,
  user: login.nullable().optional(),
  head: z.object({ ref: z.string().min(1) }),
  base: z.object({ ref: z.string().min(1) }),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PullRequestPayload = z.infer<typeof pullRequestSchema>;

const repoEvent = {
  installation: installationRef,
  repository: repositoryRef,
  sender: senderSchema,
};

export const pushEventSchema = z.object({
  ...repoEvent,
  ref: z.string(),
  deleted: z.boolean().optional(),
  commits: z
    .array(
      z.object({
        id: z.string().regex(/^[0-9a-f]{40,64}$/),
        message: z.string(),
        timestamp: z.string(),
        url: httpsUrl,
        author: z
          .object({ name: z.string().optional(), username: z.string().optional() })
          .optional(),
      }),
    )
    .default([]),
});

export const pullRequestEventSchema = z.object({
  ...repoEvent,
  action: z.string(),
  pull_request: pullRequestSchema,
});

export const pullRequestReviewEventSchema = z.object({
  ...repoEvent,
  action: z.string(),
  pull_request: pullRequestSchema,
  review: z.object({
    id,
    user: login.nullable().optional(),
    state: z.string(),
    html_url: httpsUrl.optional(),
    submitted_at: z.string().nullable().optional(),
  }),
});

export const releaseEventSchema = z.object({
  ...repoEvent,
  action: z.string(),
  release: z.object({
    tag_name: z.string().min(1),
    name: z.string().nullable().optional(),
    html_url: httpsUrl,
    prerelease: z.boolean().optional(),
  }),
});

export const installationEventSchema = z.object({
  action: z.string(),
  installation: installationRef,
  sender: senderSchema,
});

export const installationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: installationRef,
  repositories_removed: z.array(z.object({ id })).default([]),
  sender: senderSchema,
});

/** Best-effort routing fields stored with every delivery. */
export function routingFields(payload: unknown): {
  action: string | null;
  githubInstallationId: number | null;
  githubRepositoryId: number | null;
} {
  const p = (payload ?? {}) as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
  return {
    action: typeof p.action === 'string' ? p.action.slice(0, 50) : null,
    githubInstallationId: num((p.installation as { id?: unknown } | undefined)?.id),
    githubRepositoryId: num((p.repository as { id?: unknown } | undefined)?.id),
  };
}

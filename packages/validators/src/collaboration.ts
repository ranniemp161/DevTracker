import { z } from 'zod';

const commentBody = z
  .string({ error: 'Comment is required.' })
  .trim()
  .min(1, { error: 'Comment is required.' })
  .max(10_000, { error: 'Comments must be at most 10,000 characters.' });

export const createCommentSchema = z.object({ body: commentBody });
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({ body: commentBody });
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

const cursor = z.string().max(200).optional();

export const listCommentsQuerySchema = z.object({
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;

export const listActivityQuerySchema = z.object({
  taskId: z.uuid({ error: 'Invalid task id.' }).optional(),
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/** At most this many distinct users are notified per comment. */
export const MAX_MENTIONS = 20;

/**
 * Extracts `@username` mentions (lower-cased, unique, in order). A mention must start at the
 * beginning or after a character that cannot be part of a username/email, so `a@b.com` is
 * not a mention.
 */
export function parseMentions(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /(^|[^A-Za-z0-9_.@-])@([A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9_-])/g;
  for (const match of text.matchAll(pattern)) {
    const username = match[2]!.toLowerCase();
    if (username.length >= 2 && !found.includes(username)) found.push(username);
    if (found.length >= MAX_MENTIONS) break;
  }
  return found;
}

/** GET /tasks/:id/timeline: comments and history (`all`), or comments only. Oldest first. */
export const listTimelineQuerySchema = z.object({
  kind: z.enum(['all', 'comments']).default('all'),
  cursor,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTimelineQuery = z.infer<typeof listTimelineQuerySchema>;

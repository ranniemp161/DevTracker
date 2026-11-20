import { z } from 'zod';

/** Public request form submission (decision record 0016). */
export const submitRequestSchema = z.object({
  kind: z.enum(['bug', 'request'], { error: 'Choose bug or request.' }),
  title: z
    .string({ error: 'Title is required.' })
    .trim()
    .min(3, { error: 'Title must be at least 3 characters.' })
    .max(200, { error: 'Title must be at most 200 characters.' }),
  description: z
    .string()
    .trim()
    .max(5000, { error: 'Description must be at most 5,000 characters.' })
    .optional()
    .transform((v) => v || undefined),
  name: z
    .string()
    .trim()
    .max(80, { error: 'Name must be at most 80 characters.' })
    .optional()
    .transform((v) => v || undefined),
  email: z
    .union([z.literal(''), z.email({ error: 'Enter a valid email address.' }).max(254)])
    .optional()
    .transform((v) => v || undefined),
  /** Honeypot: people never see it, bots fill it in. */
  website: z.string().max(500).optional(),
  /** Cloudflare Turnstile response token. */
  turnstileToken: z.string().max(4096).optional(),
});
export type SubmitRequestInput = z.infer<typeof submitRequestSchema>;

export const requestStatusSchema = z.enum(['new', 'accepted', 'declined']);
export const listRequestsQuerySchema = z.object({
  status: requestStatusSchema.default('new'),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export const setIntakeSchema = z.object({ enabled: z.boolean() });
export type SetIntakeInput = z.infer<typeof setIntakeSchema>;

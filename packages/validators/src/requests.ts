import { z } from 'zod';

/** Files the public form accepts (decision record 0022): screenshots and Markdown. */
export const REQUEST_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const REQUEST_FILE_TYPES = [...REQUEST_IMAGE_TYPES, 'text/markdown'] as const;
export const MAX_REQUEST_FILES = 5;
export const MAX_REQUEST_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_MARKDOWN_BYTES = 256 * 1024;

export const requestAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    contentType: z.enum(REQUEST_FILE_TYPES, {
      error: 'Attach PNG, JPEG, GIF or WebP images, or Markdown (.md) files.',
    }),
    size: z.number().int().min(1),
  })
  .superRefine((file, ctx) => {
    const markdown = file.contentType === 'text/markdown';
    const max = markdown ? MAX_REQUEST_MARKDOWN_BYTES : MAX_REQUEST_IMAGE_BYTES;
    if (file.size > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['size'],
        message: markdown
          ? 'Markdown files can be at most 256 KB.'
          : 'Images can be at most 10 MB.',
      });
    }
  });
export type RequestAttachmentInput = z.infer<typeof requestAttachmentSchema>;

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
  /** Files to upload after submitting (0022). */
  attachments: z
    .array(requestAttachmentSchema)
    .max(MAX_REQUEST_FILES, { error: `Attach at most ${MAX_REQUEST_FILES} files.` })
    .default([]),
});
export type SubmitRequestInput = z.infer<typeof submitRequestSchema>;

export const requestStatusSchema = z.enum(['new', 'accepted', 'declined']);
export const listRequestsQuerySchema = z.object({
  status: requestStatusSchema.default('new'),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

export const setIntakeSchema = z.object({ enabled: z.boolean() });
export type SetIntakeInput = z.infer<typeof setIntakeSchema>;

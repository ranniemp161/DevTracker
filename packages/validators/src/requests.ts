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

const requestKind = z.enum(['bug', 'request'], { error: 'Choose bug or request.' });
const requestTitle = z
  .string({ error: 'Title is required.' })
  .trim()
  .min(3, { error: 'Title must be at least 3 characters.' })
  .max(200, { error: 'Title must be at most 200 characters.' });
const requestDescription = z
  .string()
  .trim()
  .max(5000, { error: 'Description must be at most 5,000 characters.' })
  .optional()
  .transform((v) => v || undefined);

/** Public request form submission (decision record 0016). */
export const submitRequestSchema = z.object({
  kind: requestKind,
  title: requestTitle,
  description: requestDescription,
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

/** A member's proposal (decision record 0023 §3). */
export const proposeTaskSchema = z.object({
  kind: requestKind,
  title: requestTitle,
  description: requestDescription,
});
export type ProposeTaskInput = z.infer<typeof proposeTaskSchema>;

export const requestStatusSchema = z.enum(['new', 'accepted', 'declined']);
export const listRequestsQuerySchema = z.object({
  status: requestStatusSchema.default('new'),
  /** 0023 §4: only form requests, or only team proposals. Both when left out. */
  source: z.enum(['form', 'internal']).optional(),
});
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

/** Declining takes an optional reason for the proposer (0023 §4). */
export const declineRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(500, { error: 'Reason must be at most 500 characters.' })
      .optional()
      .transform((v) => v || undefined),
  })
  .default({ reason: undefined });
export type DeclineRequestInput = z.infer<typeof declineRequestSchema>;

const requestUuid = z.uuid({ error: 'Invalid id.' });

/**
 * 0024 §3: accepting files the task into an open milestone, or leaves it unscheduled (`null`).
 * The choice is required so it is always made on purpose. Assignees are optional.
 */
export const acceptRequestSchema = z.object({
  milestoneId: z
    .union([requestUuid, z.null()], { error: 'Choose a milestone, or Unscheduled.' })
    .transform((id) => id?.toLowerCase() ?? null),
  assigneeIds: z
    .array(requestUuid)
    .max(20, { error: 'At most 20 assignees.' })
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])
    .optional(),
});
export type AcceptRequestInput = z.infer<typeof acceptRequestSchema>;

/** 0023 §5: `GET /projects/:id/proposals?mine=true`; there is no list of everyone's. */
export const listProposalsQuerySchema = z.object({
  mine: z.literal('true', { error: 'Only your own proposals can be listed (mine=true).' }),
});
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

export const setIntakeSchema = z.object({ enabled: z.boolean() });
export type SetIntakeInput = z.infer<typeof setIntakeSchema>;

/** 0028 §2: the "Stop emails about this request" link's token. */
export const stopClientEmailsSchema = z.object({ token: z.string().trim().min(1).max(200) });
export type StopClientEmailsInput = z.infer<typeof stopClientEmailsSchema>;

/** 0028 §4: Approve on the client's sign-off page. Same spam protection as the request form. */
export const approveSignoffSchema = z.object({
  name: z
    .string()
    .trim()
    .max(80, { error: 'Name must be at most 80 characters.' })
    .optional()
    .transform((v) => v || undefined),
  note: z
    .string()
    .trim()
    .max(500, { error: 'Note must be at most 500 characters.' })
    .optional()
    .transform((v) => v || undefined),
  website: z.string().max(500).optional(),
  turnstileToken: z.string().max(4096).optional(),
});
export type ApproveSignoffInput = z.infer<typeof approveSignoffSchema>;

/** 0028 §3: `POST /milestones/:id/signoff-link`; `replace` makes a new link and retires the old. */
export const signoffLinkSchema = z.object({ replace: z.boolean().optional() });
export type SignoffLinkInput = z.infer<typeof signoffLinkSchema>;

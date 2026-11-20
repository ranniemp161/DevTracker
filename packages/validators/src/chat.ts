import { z } from 'zod';

const uuid = z.uuid({ error: 'Invalid id.' });

const chatMessageBody = z
  .string({ error: 'Message body is required.' })
  .trim()
  .min(1, { error: 'Message body is required.' })
  .max(10_000, { error: 'Message must be at most 10,000 characters.' });

export const MAX_CHAT_ATTACHMENT_BYTES = 32 * 1024;

export const createChatMessageSchema = z
  .object({
    body: z.string().trim().max(10_000),
    attachment: z
      .object({
        name: z
          .string()
          .trim()
          .min(4)
          .max(255)
          .refine(
            (name) =>
              /^[^/\\]+\.md$/i.test(name) &&
              [...name].every((character) => character >= ' ' && character.charCodeAt(0) !== 127) &&
              !/\p{Surrogate}/u.test(name),
            'Choose a Markdown (.md) file.',
          ),
        base64: z
          .base64()
          .min(1)
          .max(Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3) * 4),
      })
      .optional(),
    clientRequestId: z
      .string({ error: 'Client request ID is required.' })
      .trim()
      .min(1, { error: 'Client request ID is required.' })
      .max(128, { error: 'Client request ID is too long.' }),
    taskId: uuid.optional(),
  })
  .refine((data) => Boolean(data.body || data.attachment), {
    path: ['body'],
    error: 'Enter a message or attach a Markdown file.',
  });
export type CreateChatMessageInput = z.infer<typeof createChatMessageSchema>;

export const updateChatMessageSchema = z
  .object({
    body: chatMessageBody.optional(),
    taskId: uuid.nullable().optional(),
  })
  .refine((data) => data.body !== undefined || data.taskId !== undefined, {
    error: 'Either body or taskId must be provided.',
  });
export type UpdateChatMessageInput = z.infer<typeof updateChatMessageSchema>;

export const markChatReadSchema = z.object({
  sequence: z.coerce.number().int().min(0, { error: 'Sequence must be non-negative.' }),
});
export type MarkChatReadInput = z.infer<typeof markChatReadSchema>;

export const listChatMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().min(0).optional(),
  around: uuid.optional(),
  unread: z.literal('1').optional(),
});
export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuerySchema>;

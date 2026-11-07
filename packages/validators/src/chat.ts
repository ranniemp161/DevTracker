import { z } from 'zod';

const uuid = z.uuid({ error: 'Invalid id.' });

const chatMessageBody = z
  .string({ error: 'Message body is required.' })
  .trim()
  .min(1, { error: 'Message body is required.' })
  .max(10_000, { error: 'Message must be at most 10,000 characters.' });

export const createChatMessageSchema = z.object({
  body: chatMessageBody,
  clientRequestId: z
    .string({ error: 'Client request ID is required.' })
    .trim()
    .min(1, { error: 'Client request ID is required.' })
    .max(128, { error: 'Client request ID is too long.' }),
  taskId: uuid.optional(),
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
});
export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuerySchema>;

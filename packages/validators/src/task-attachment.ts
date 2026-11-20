import { z } from 'zod';

export const TASK_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;
export const MAX_TASK_MEDIA_BYTES = 50 * 1024 * 1024;

export const createTaskAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  contentType: z.enum(TASK_MEDIA_TYPES),
  size: z.number().int().min(1).max(MAX_TASK_MEDIA_BYTES),
});

export type CreateTaskAttachmentInput = z.infer<typeof createTaskAttachmentSchema>;

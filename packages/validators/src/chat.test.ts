import { describe, expect, it } from 'vitest';
import {
  createChatMessageSchema,
  listChatMessagesQuerySchema,
  markChatReadSchema,
  updateChatMessageSchema,
} from './chat.js';

describe('chat validators', () => {
  it('validates createChatMessageSchema', () => {
    const valid = createChatMessageSchema.safeParse({
      body: 'Hello world',
      clientRequestId: 'req-123',
    });
    expect(valid.success).toBe(true);

    const empty = createChatMessageSchema.safeParse({
      body: '   ',
      clientRequestId: 'req-123',
    });
    expect(empty.success).toBe(false);

    const missingReqId = createChatMessageSchema.safeParse({
      body: 'Hello',
    });
    expect(missingReqId.success).toBe(false);

    const withTask = createChatMessageSchema.safeParse({
      body: 'Hello',
      clientRequestId: 'req-123',
      taskId: 'a0000000-0000-4000-8000-000000000001',
    });
    expect(withTask.success).toBe(true);
  });

  it('validates updateChatMessageSchema', () => {
    expect(updateChatMessageSchema.safeParse({ body: 'Updated text' }).success).toBe(true);
    expect(
      updateChatMessageSchema.safeParse({ taskId: 'a0000000-0000-4000-8000-000000000001' }).success,
    ).toBe(true);
    expect(updateChatMessageSchema.safeParse({ taskId: null }).success).toBe(true);
    expect(updateChatMessageSchema.safeParse({}).success).toBe(false);
  });

  it('validates markChatReadSchema', () => {
    expect(markChatReadSchema.safeParse({ sequence: 5 }).success).toBe(true);
    expect(markChatReadSchema.safeParse({ sequence: '10' }).success).toBe(true);
    expect(markChatReadSchema.safeParse({ sequence: -1 }).success).toBe(false);
  });

  it('validates listChatMessagesQuerySchema', () => {
    const defaultQuery = listChatMessagesQuerySchema.parse({});
    expect(defaultQuery.limit).toBe(50);

    const custom = listChatMessagesQuerySchema.parse({
      limit: '25',
      before: '100',
    });
    expect(custom.limit).toBe(25);
    expect(custom.before).toBe(100);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createCommentSchema,
  listNotificationsQuerySchema,
  parseMentions,
} from './collaboration.js';

describe('parseMentions', () => {
  it.each([
    ['@ada please review', ['ada']],
    ['cc @Ada and @bob-2, thanks @ada', ['ada', 'bob-2']],
    ['(@ada) and "@bob"', ['ada', 'bob']],
    ['email me at ada@example.com', []],
    ['@a is too short', []],
    ['trailing dash @ada- is not valid', []],
    ['no mentions here', []],
  ])('%j -> %j', (text, expected) => {
    expect(parseMentions(text)).toEqual(expected);
  });

  it('caps the number of mentions', () => {
    const text = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(' ');
    expect(parseMentions(text)).toHaveLength(20);
  });
});

describe('comment schemas', () => {
  it('trims and bounds the body', () => {
    expect(createCommentSchema.parse({ body: '  hi  ' })).toEqual({ body: 'hi' });
    expect(createCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });

  it('parses notification list queries', () => {
    expect(listNotificationsQuerySchema.parse({ unreadOnly: 'true' })).toEqual({
      unreadOnly: true,
      limit: 20,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  safeRedirectPath,
  tokenSchema,
  usernameSchema,
} from './auth.js';

describe('emailSchema', () => {
  it('normalizes case and whitespace', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
  });
  it('rejects invalid addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });
});

describe('usernameSchema', () => {
  it('lower-cases valid usernames', () => {
    expect(usernameSchema.parse('Ada_Lovelace-1')).toBe('ada_lovelace-1');
  });
  it.each(['a', '-ada', 'ada-', 'ada lovelace', 'ada@x', 'x'.repeat(40)])('rejects %j', (v) => {
    expect(usernameSchema.safeParse(v).success).toBe(false);
  });
  it('accepts 2 and 39 character usernames', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(true);
    expect(usernameSchema.safeParse('a'.repeat(39)).success).toBe(true);
  });
});

describe('passwordSchema', () => {
  it('enforces length bounds', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('long-enough').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });
});

describe('registerSchema / loginSchema', () => {
  it('parses a valid registration', () => {
    const parsed = registerSchema.parse({
      email: 'Ada@Example.com',
      username: 'Ada',
      password: 'correct horse battery',
    });
    expect(parsed).toEqual({
      email: 'ada@example.com',
      username: 'ada',
      password: 'correct horse battery',
    });
  });
  it('does not apply strength rules at login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('tokenSchema', () => {
  it('accepts base64url tokens and rejects others', () => {
    expect(tokenSchema.safeParse('abcDEF0123456789_-xyz').success).toBe(true);
    expect(tokenSchema.safeParse('short').success).toBe(false);
    expect(tokenSchema.safeParse('has spaces in the token value').success).toBe(false);
  });
});

describe('safeRedirectPath', () => {
  it.each([
    ['/projects/1?tab=a', '/projects/1?tab=a'],
    ['/', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/ok\r\nSet-Cookie: x', '/'],
    [undefined, '/'],
    [42, '/'],
  ])('%j -> %j', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

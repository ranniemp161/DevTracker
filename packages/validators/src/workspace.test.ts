import { describe, expect, it } from 'vitest';
import {
  changeMemberRoleSchema,
  createInvitationSchema,
  createWorkspaceSchema,
  slugify,
} from './workspace.js';

describe('slugify', () => {
  it.each([
    ['Acme Engineering', 'acme-engineering'],
    ['  Platform -- Team!! ', 'platform-team'],
    ['Café Ünïcode', 'cafe-unicode'],
    ['日本語', 'workspace'],
    ['---', 'workspace'],
    ['a'.repeat(60), 'a'.repeat(48)],
  ])('%j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('never ends with a hyphen after truncation', () => {
    expect(slugify(`${'a'.repeat(47)} b`)).toBe('a'.repeat(47));
  });
});

describe('workspace schemas', () => {
  it('trims names and rejects empty or long ones', () => {
    expect(createWorkspaceSchema.parse({ name: '  Acme  ' })).toEqual({ name: 'Acme' });
    expect(createWorkspaceSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });

  it('never accepts OWNER as an assignable role', () => {
    expect(createInvitationSchema.safeParse({ email: 'a@b.co', role: 'OWNER' }).success).toBe(
      false,
    );
    expect(changeMemberRoleSchema.safeParse({ role: 'OWNER' }).success).toBe(false);
    expect(createInvitationSchema.parse({ email: 'A@B.co', role: 'ADMIN' })).toEqual({
      email: 'a@b.co',
      role: 'ADMIN',
    });
  });
});

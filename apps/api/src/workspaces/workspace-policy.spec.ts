import type { WorkspaceRole } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { canChangeRole, canInvite, canRemoveMember, hasAtLeastRole } from './workspace-policy';

const actor = (role: WorkspaceRole, userId = 'actor') => ({ userId, role });
const target = (role: WorkspaceRole, userId = 'target') => ({ userId, role });

describe('hasAtLeastRole', () => {
  it('orders OWNER > ADMIN > MEMBER', () => {
    expect(hasAtLeastRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasAtLeastRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasAtLeastRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasAtLeastRole('MEMBER', 'MEMBER')).toBe(true);
  });
});

describe('canInvite', () => {
  it.each([
    ['OWNER', 'ADMIN', true],
    ['OWNER', 'MEMBER', true],
    ['ADMIN', 'ADMIN', true],
    ['ADMIN', 'MEMBER', true],
    ['MEMBER', 'MEMBER', false],
  ] as const)('%s inviting as %s -> %s', (a, role, allowed) => {
    expect(canInvite(a, role).allowed).toBe(allowed);
  });
});

describe('canChangeRole', () => {
  it.each([
    // actor, target, expected
    ['OWNER', 'ADMIN', 'ALLOW'],
    ['OWNER', 'MEMBER', 'ALLOW'],
    ['ADMIN', 'MEMBER', 'ALLOW'],
    ['ADMIN', 'ADMIN', 'FORBIDDEN'],
    ['MEMBER', 'MEMBER', 'FORBIDDEN'],
    ['MEMBER', 'ADMIN', 'FORBIDDEN'],
    ['ADMIN', 'OWNER', 'OWNER_PROTECTED'],
    ['MEMBER', 'OWNER', 'OWNER_PROTECTED'],
  ] as const)('%s changing %s -> %s', (a, t, expected) => {
    const d = canChangeRole(actor(a), target(t));
    expect(d.allowed ? 'ALLOW' : d.reason).toBe(expected);
  });

  it('protects the owner from changing their own role', () => {
    const d = canChangeRole(actor('OWNER', 'me'), target('OWNER', 'me'));
    expect(d).toEqual({ allowed: false, reason: 'OWNER_PROTECTED' });
  });

  it('does not let an admin demote themselves', () => {
    expect(canChangeRole(actor('ADMIN', 'me'), target('ADMIN', 'me')).allowed).toBe(false);
  });
});

describe('canRemoveMember', () => {
  it.each([
    ['OWNER', 'ADMIN', 'ALLOW'],
    ['OWNER', 'MEMBER', 'ALLOW'],
    ['ADMIN', 'MEMBER', 'ALLOW'],
    ['ADMIN', 'ADMIN', 'FORBIDDEN'],
    ['MEMBER', 'MEMBER', 'FORBIDDEN'],
    ['ADMIN', 'OWNER', 'OWNER_PROTECTED'],
  ] as const)('%s removing %s -> %s', (a, t, expected) => {
    const d = canRemoveMember(actor(a), target(t));
    expect(d.allowed ? 'ALLOW' : d.reason).toBe(expected);
  });

  it('lets admins and members leave, but not the owner', () => {
    expect(canRemoveMember(actor('MEMBER', 'me'), target('MEMBER', 'me')).allowed).toBe(true);
    expect(canRemoveMember(actor('ADMIN', 'me'), target('ADMIN', 'me')).allowed).toBe(true);
    expect(canRemoveMember(actor('OWNER', 'me'), target('OWNER', 'me'))).toEqual({
      allowed: false,
      reason: 'OWNER_PROTECTED',
    });
  });
});

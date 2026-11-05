import { eq, invitations, workspaceMembers } from '@devtrack/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/common/crypto/tokens';
import {
  createTestApp,
  registerUser,
  verifiedUser,
  WEB_ORIGIN,
  type TestApp,
} from './utils/test-app';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

type U = Awaited<ReturnType<typeof verifiedUser>>;
const RANDOM_UUID = '7c2d6f0e-3c55-4a8a-9d55-2f3c3b9b1a11';

async function createWorkspace(user: U, name = 'Acme Engineering'): Promise<string> {
  const res = await user.browser.post('/api/v1/workspaces').send({ name });
  expect(res.status).toBe(201);
  return res.body.data.workspace.id;
}

function invite(by: U, workspaceId: string, email: string, role: 'ADMIN' | 'MEMBER' = 'MEMBER') {
  return by.browser.post(`/api/v1/workspaces/${workspaceId}/invitations`).send({ email, role });
}

/** Invites `user` with `role` and has them accept. */
async function addMember(
  owner: U,
  workspaceId: string,
  user: U,
  role: 'ADMIN' | 'MEMBER' = 'MEMBER',
) {
  await invite(owner, workspaceId, user.email, role).expect(201);
  const token = t.mailer.lastToken(user.email, 'invited you');
  await user.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
}

/** A workspace with an owner, an admin, a member, and an outsider. */
async function team() {
  const owner = await verifiedUser(t, 'owner');
  const admin = await verifiedUser(t, 'admin');
  const member = await verifiedUser(t, 'member');
  const outsider = await verifiedUser(t, 'outsider');
  const ws = await createWorkspace(owner);
  await addMember(owner, ws, admin, 'ADMIN');
  await addMember(owner, ws, member, 'MEMBER');
  return { owner, admin, member, outsider, ws };
}

describe('workspaces', () => {
  it('creates a workspace with the creator as its single owner and a generated slug', async () => {
    const owner = await verifiedUser(t, 'owner');
    const res = await owner.browser
      .post('/api/v1/workspaces')
      .send({ name: '  Acme Engineering ' });
    expect(res.status).toBe(201);
    expect(res.body.data.workspace).toMatchObject({
      name: 'Acme Engineering',
      slug: 'acme-engineering',
      role: 'OWNER',
    });

    const second = await owner.browser
      .post('/api/v1/workspaces')
      .send({ name: 'Acme Engineering' });
    expect(second.body.data.workspace.slug).toBe('acme-engineering-2');

    const members = await t.db.select().from(workspaceMembers);
    expect(members.filter((m) => m.role === 'OWNER')).toHaveLength(2); // one per workspace
  });

  it('requires a verified email', async () => {
    const browser = t.browser();
    await registerUser(browser, { email: 'new@example.com', username: 'newbie' });
    const res = await browser.post('/api/v1/workspaces').send({ name: 'Nope' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('lists only workspaces the user belongs to, with their role', async () => {
    const { admin, outsider, ws } = await team();
    await createWorkspace(outsider, 'Outsider Co');

    const adminList = await admin.browser.get('/api/v1/workspaces').expect(200);
    expect(adminList.body.data).toEqual([expect.objectContaining({ id: ws, role: 'ADMIN' })]);

    const outsiderList = await outsider.browser.get('/api/v1/workspaces').expect(200);
    expect(outsiderList.body.data.map((w: { name: string }) => w.name)).toEqual(['Outsider Co']);
  });

  it('returns details with member count to members', async () => {
    const { member, ws } = await team();
    const res = await member.browser.get(`/api/v1/workspaces/${ws}`).expect(200);
    expect(res.body.data.workspace).toMatchObject({ id: ws, role: 'MEMBER', memberCount: 3 });
  });

  it('hides workspaces from non-members, unknown IDs and malformed IDs with the same 404', async () => {
    const { outsider, ws } = await team();
    for (const id of [ws, RANDOM_UUID, 'not-a-uuid']) {
      const res = await outsider.browser.get(`/api/v1/workspaces/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('lets admins and the owner rename, but not members; the slug never changes', async () => {
    const { owner, admin, member, ws } = await team();
    expect(
      (await member.browser.patch(`/api/v1/workspaces/${ws}`).send({ name: 'X' })).status,
    ).toBe(403);

    const res = await admin.browser
      .patch(`/api/v1/workspaces/${ws}`)
      .send({ name: 'Acme Platform' });
    expect(res.status).toBe(200);
    expect(res.body.data.workspace).toMatchObject({
      name: 'Acme Platform',
      slug: 'acme-engineering',
    });

    await owner.browser.patch(`/api/v1/workspaces/${ws}`).send({ name: 'Acme' }).expect(200);
  });

  it('archives on DELETE (owner only); archived workspaces disappear for everyone', async () => {
    const { owner, admin, ws } = await team();
    expect((await admin.browser.delete(`/api/v1/workspaces/${ws}`)).status).toBe(403);
    expect((await owner.browser.delete(`/api/v1/workspaces/${ws}`)).status).toBe(204);

    expect((await owner.browser.get(`/api/v1/workspaces/${ws}`)).status).toBe(404);
    expect((await admin.browser.get('/api/v1/workspaces')).body.data).toEqual([]);
    expect((await admin.browser.get(`/api/v1/workspaces/${ws}/members`)).status).toBe(404);
  });
});

describe('members', () => {
  it('lists members owner-first for any member, never for outsiders', async () => {
    const { member, outsider, ws } = await team();
    const res = await member.browser.get(`/api/v1/workspaces/${ws}/members`).expect(200);
    expect(
      res.body.data.map((m: { user: { username: string }; role: string }) => [
        m.user.username,
        m.role,
      ]),
    ).toEqual([
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['member', 'MEMBER'],
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect((await outsider.browser.get(`/api/v1/workspaces/${ws}/members`)).status).toBe(404);
  });

  it('applies the role-change rules', async () => {
    const { owner, admin, member, ws } = await team();
    const patch = (by: U, target: U, role: string) =>
      by.browser.patch(`/api/v1/workspaces/${ws}/members/${target.id}`).send({ role });

    // Members cannot change roles.
    expect((await patch(member, admin, 'MEMBER')).status).toBe(403);
    // Admins cannot change other admins (or themselves).
    expect((await patch(admin, admin, 'MEMBER')).status).toBe(403);
    // Nobody can change the owner, and OWNER can never be granted.
    const ownerChange = await patch(admin, owner, 'MEMBER');
    expect(ownerChange.status).toBe(403);
    expect(ownerChange.body.error.code).toBe('OWNER_PROTECTED');
    expect((await patch(owner, owner, 'ADMIN')).body.error.code).toBe('OWNER_PROTECTED');
    expect((await patch(owner, member, 'OWNER')).status).toBe(400);

    // Admins can promote members; owners can demote admins.
    const promoted = await patch(admin, member, 'ADMIN');
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.member).toMatchObject({
      role: 'ADMIN',
      user: { username: 'member' },
    });
    expect((await patch(owner, admin, 'MEMBER')).body.data.member.role).toBe('MEMBER');
  });

  it('applies the removal rules, including self-leave', async () => {
    const { owner, admin, member, outsider, ws } = await team();
    const remove = (by: U, target: U) =>
      by.browser.delete(`/api/v1/workspaces/${ws}/members/${target.id}`);

    expect((await remove(member, admin)).status).toBe(403);
    expect((await remove(admin, owner)).body.error.code).toBe('OWNER_PROTECTED');
    expect((await remove(owner, owner)).body.error.code).toBe('OWNER_PROTECTED'); // owner cannot leave
    expect((await remove(owner, outsider)).status).toBe(404); // not a member

    expect((await remove(admin, member)).status).toBe(204);
    expect((await member.browser.get(`/api/v1/workspaces/${ws}`)).status).toBe(404); // access gone

    expect((await remove(admin, admin)).status).toBe(204); // admin leaves
    expect((await admin.browser.get(`/api/v1/workspaces/${ws}`)).status).toBe(404);
  });

  it('lets only the owner remove an admin', async () => {
    const { owner, admin, ws } = await team();
    const otherAdmin = await verifiedUser(t, 'admin2');
    await addMember(owner, ws, otherAdmin, 'ADMIN');
    expect(
      (await admin.browser.delete(`/api/v1/workspaces/${ws}/members/${otherAdmin.id}`)).status,
    ).toBe(403);
    expect(
      (await owner.browser.delete(`/api/v1/workspaces/${ws}/members/${otherAdmin.id}`)).status,
    ).toBe(204);
  });
});

describe('invitations', () => {
  it('sends a single-use emailed link and stores only the token hash', async () => {
    const owner = await verifiedUser(t, 'owner');
    const ws = await createWorkspace(owner);

    const res = await invite(owner, ws, 'Invitee@Example.com', 'ADMIN');
    expect(res.status).toBe(201);
    expect(res.body.data.invitation).toMatchObject({
      email: 'invitee@example.com',
      role: 'ADMIN',
      status: 'PENDING',
      invitedBy: { username: 'owner' },
    });

    const mail = t.mailer.messages.at(-1)!;
    expect(mail.subject).toBe('owner invited you to Acme Engineering on DevTrack');
    expect(mail.text).toContain(`${WEB_ORIGIN}/invitations/accept#token=`);
    const token = t.mailer.lastToken('invitee@example.com', 'invited you');
    const [row] = await t.db.select().from(invitations);
    expect(row!.tokenHash).toBe(hashToken(token));
    // Default expiry: seven days.
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBeGreaterThan(6.9 * 86_400_000);
  });

  it('lets an existing user accept and join with the invited role, exactly once', async () => {
    const owner = await verifiedUser(t, 'owner');
    const invitee = await verifiedUser(t, 'invitee');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, invitee.email, 'ADMIN').expect(201);
    const token = t.mailer.lastToken(invitee.email, 'invited you');

    const accepted = await invitee.browser.post('/api/v1/invitations/accept').send({ token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.workspace).toMatchObject({ id: ws, role: 'ADMIN' });
    await invitee.browser.get(`/api/v1/workspaces/${ws}`).expect(200);

    const replay = await invitee.browser.post('/api/v1/invitations/accept').send({ token });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVITATION_INVALID');
  });

  it('lets a brand-new user register, verify, then accept', async () => {
    const owner = await verifiedUser(t, 'owner');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, 'newcomer@example.com').expect(201);
    const inviteToken = t.mailer.lastToken('newcomer@example.com', 'invited you');

    const newcomer = await verifiedUser(t, 'newcomer');
    const res = await newcomer.browser
      .post('/api/v1/invitations/accept')
      .send({ token: inviteToken });
    expect(res.status).toBe(200);
    expect(res.body.data.workspace.role).toBe('MEMBER');
  });

  it('rejects acceptance by a different account (forwarded link)', async () => {
    const owner = await verifiedUser(t, 'owner');
    const intended = await verifiedUser(t, 'intended');
    const other = await verifiedUser(t, 'other');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, intended.email).expect(201);
    const token = t.mailer.lastToken(intended.email, 'invited you');

    const res = await other.browser.post('/api/v1/invitations/accept').send({ token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVITATION_EMAIL_MISMATCH');
    expect((await other.browser.get(`/api/v1/workspaces/${ws}`)).status).toBe(404);

    // The invitation is still usable by the right person.
    await intended.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
  });

  it('requires a verified email to accept', async () => {
    const owner = await verifiedUser(t, 'owner');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, 'unverified@example.com').expect(201);
    const token = t.mailer.lastToken('unverified@example.com', 'invited you');

    const browser = t.browser();
    await registerUser(browser, { email: 'unverified@example.com', username: 'unverified' });
    const res = await browser.post('/api/v1/invitations/accept').send({ token });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects expired invitations and invitations to archived workspaces', async () => {
    const owner = await verifiedUser(t, 'owner');
    const invitee = await verifiedUser(t, 'invitee');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, invitee.email).expect(201);
    const token = t.mailer.lastToken(invitee.email, 'invited you');

    await t.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(
      (await invitee.browser.post('/api/v1/invitations/accept').send({ token })).body.error.code,
    ).toBe('INVITATION_INVALID');
    const listed = await owner.browser.get(`/api/v1/workspaces/${ws}/invitations`).expect(200);
    expect(listed.body.data[0].status).toBe('EXPIRED');

    await invite(owner, ws, invitee.email).expect(201);
    const fresh = t.mailer.lastToken(invitee.email, 'invited you');
    await owner.browser.delete(`/api/v1/workspaces/${ws}`).expect(204);
    expect(
      (await invitee.browser.post('/api/v1/invitations/accept').send({ token: fresh })).status,
    ).toBe(400);
  });

  it('re-inviting revokes the previous link', async () => {
    const owner = await verifiedUser(t, 'owner');
    const invitee = await verifiedUser(t, 'invitee');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, invitee.email).expect(201);
    const first = t.mailer.lastToken(invitee.email, 'invited you');
    await invite(owner, ws, invitee.email, 'ADMIN').expect(201);
    const second = t.mailer.lastToken(invitee.email, 'invited you');

    const listed = await owner.browser.get(`/api/v1/workspaces/${ws}/invitations`).expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].role).toBe('ADMIN');

    expect(
      (await invitee.browser.post('/api/v1/invitations/accept').send({ token: first })).status,
    ).toBe(400);
    const ok = await invitee.browser.post('/api/v1/invitations/accept').send({ token: second });
    expect(ok.body.data.workspace.role).toBe('ADMIN');
  });

  it('enforces who can invite, and refuses existing members and OWNER', async () => {
    const { owner, admin, member, ws } = await team();
    expect((await invite(member, ws, 'x@example.com')).status).toBe(403);
    expect((await invite(admin, ws, 'x@example.com', 'ADMIN')).status).toBe(201);

    const dup = await invite(owner, ws, member.email);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');

    const asOwner = await owner.browser
      .post(`/api/v1/workspaces/${ws}/invitations`)
      .send({ email: 'y@example.com', role: 'OWNER' });
    expect(asOwner.status).toBe(400);
  });

  it('lets admins list and revoke; revoked links stop working; members cannot see invitations', async () => {
    const { owner, admin, member, ws } = await team();
    const invitee = await verifiedUser(t, 'invitee');
    const created = await invite(owner, ws, invitee.email).expect(201);
    const id = created.body.data.invitation.id;
    const token = t.mailer.lastToken(invitee.email, 'invited you');

    expect((await member.browser.get(`/api/v1/workspaces/${ws}/invitations`)).status).toBe(403);
    expect((await member.browser.post(`/api/v1/invitations/${id}/revoke`)).status).toBe(403);

    const revoked = await admin.browser.post(`/api/v1/invitations/${id}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.invitation.status).toBe('REVOKED');

    const again = await admin.browser.post(`/api/v1/invitations/${id}/revoke`);
    expect(again.body.error.code).toBe('INVITATION_NOT_PENDING');

    expect((await invitee.browser.post('/api/v1/invitations/accept').send({ token })).status).toBe(
      400,
    );
    expect((await admin.browser.get(`/api/v1/workspaces/${ws}/invitations`)).body.data).toEqual([]);
  });

  it('keeps an existing member at their current role if they accept a stale invitation', async () => {
    const owner = await verifiedUser(t, 'owner');
    const invitee = await verifiedUser(t, 'invitee');
    const ws = await createWorkspace(owner);
    await invite(owner, ws, invitee.email, 'ADMIN').expect(201);
    const token = t.mailer.lastToken(invitee.email, 'invited you');
    // Simulate the user joining by another route before accepting.
    await t.db
      .insert(workspaceMembers)
      .values({ workspaceId: ws, userId: invitee.id, role: 'MEMBER' });

    const res = await invitee.browser.post('/api/v1/invitations/accept').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.data.workspace.role).toBe('MEMBER');
    const rows = await t.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, invitee.id));
    expect(rows).toHaveLength(1);
  });
});

describe('cross-workspace isolation (architecture §6, §16 security tests)', () => {
  it('an admin of one workspace cannot touch another workspace or its invitations', async () => {
    const a = await team();
    const otherOwner = await verifiedUser(t, 'otherowner');
    const otherMember = await verifiedUser(t, 'othermember');
    const wsB = await createWorkspace(otherOwner, 'Other Co');
    await addMember(otherOwner, wsB, otherMember);
    const invB = await invite(otherOwner, wsB, 'someone@example.com').expect(201);

    const attacker = a.admin;
    // Thunks, run one at a time (supertest requests start when awaited).
    const checks = [
      () => attacker.browser.get(`/api/v1/workspaces/${wsB}`),
      () => attacker.browser.patch(`/api/v1/workspaces/${wsB}`).send({ name: 'pwned' }),
      () => attacker.browser.delete(`/api/v1/workspaces/${wsB}`),
      () => attacker.browser.get(`/api/v1/workspaces/${wsB}/members`),
      () =>
        attacker.browser
          .patch(`/api/v1/workspaces/${wsB}/members/${otherMember.id}`)
          .send({ role: 'ADMIN' }),
      () => attacker.browser.delete(`/api/v1/workspaces/${wsB}/members/${otherMember.id}`),
      () => attacker.browser.get(`/api/v1/workspaces/${wsB}/invitations`),
      () =>
        attacker.browser
          .post(`/api/v1/workspaces/${wsB}/invitations`)
          .send({ email: 'x@example.com', role: 'ADMIN' }),
      () => attacker.browser.post(`/api/v1/invitations/${invB.body.data.invitation.id}/revoke`),
      // Operating on B's member through A's workspace URL does nothing either.
      () => attacker.browser.delete(`/api/v1/workspaces/${a.ws}/members/${otherMember.id}`),
    ];
    for (const check of checks) {
      expect((await check()).status).toBe(404);
    }
    const members = await otherOwner.browser.get(`/api/v1/workspaces/${wsB}/members`).expect(200);
    expect(members.body.data).toHaveLength(2);
  });
});

describe('rate limits', () => {
  it('limits invitation creation per user', async () => {
    const owner = await verifiedUser(t, 'owner');
    const ws = await createWorkspace(owner);
    for (let i = 0; i < 30; i++) await invite(owner, ws, `person${i}@example.com`).expect(201);
    const limited = await invite(owner, ws, 'one-more@example.com');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

import { expect } from 'vitest';
import { verifiedUser, type TestApp } from './test-app';

export type TestUser = Awaited<ReturnType<typeof verifiedUser>>;

export async function joinWorkspace(
  t: TestApp,
  owner: TestUser,
  workspaceId: string,
  user: TestUser,
  role: 'ADMIN' | 'MEMBER',
) {
  await owner.browser
    .post(`/api/v1/workspaces/${workspaceId}/invitations`)
    .send({ email: user.email, role })
    .expect(201);
  const token = t.mailer.lastToken(user.email, 'invited you');
  await user.browser.post('/api/v1/invitations/accept').send({ token }).expect(200);
}

/**
 * Workspace "Acme" with owner, admin, `dev` (Member, on project DEV), `bystander` (Member,
 * not on the project) and `outsider` (not in the workspace).
 */
export async function projectFixture(t: TestApp) {
  const [owner, admin, dev, bystander, outsider] = await Promise.all(
    ['owner', 'admin', 'dev', 'bystander', 'outsider'].map((u) => verifiedUser(t, u)),
  );
  const ws: string = (await owner!.browser.post('/api/v1/workspaces').send({ name: 'Acme' })).body
    .data.workspace.id;
  await joinWorkspace(t, owner!, ws, admin!, 'ADMIN');
  await joinWorkspace(t, owner!, ws, dev!, 'MEMBER');
  await joinWorkspace(t, owner!, ws, bystander!, 'MEMBER');
  const created = await owner!.browser
    .post(`/api/v1/workspaces/${ws}/projects`)
    .send({ name: 'Developer Platform', key: 'DEV' });
  expect(created.status).toBe(201);
  const project: string = created.body.data.project.id;
  await owner!.browser.post(`/api/v1/projects/${project}/members`).send({ userId: dev!.id }).expect(201);
  return { owner: owner!, admin: admin!, dev: dev!, bystander: bystander!, outsider: outsider!, ws, project };
}

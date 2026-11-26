import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { projectFixture } from './utils/fixtures';
import { createTestApp, type TestApp } from './utils/test-app';

/** Decision record 0023 §7: a display-only job title. */
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

type Fixture = Awaited<ReturnType<typeof projectFixture>>;
type U = Fixture['dev'];

const setTitle = (u: U, jobTitle: unknown) => u.browser.patch('/api/v1/auth/me').send({ jobTitle });

const myTitle = async (u: U) =>
  (await u.browser.get('/api/v1/auth/me').expect(200)).body.data.user.jobTitle as string | null;

describe('setting your job title', () => {
  it('stores a trimmed title of up to 80 characters, and clears it', async () => {
    const { dev } = await projectFixture(t);
    expect(await myTitle(dev)).toBeNull();

    const saved = await setTitle(dev, '  Backend developer  ').expect(200);
    expect(saved.body.data.user.jobTitle).toBe('Backend developer');
    expect(await myTitle(dev)).toBe('Backend developer');

    expect((await setTitle(dev, 'x'.repeat(81))).status).toBe(400);
    expect(await myTitle(dev)).toBe('Backend developer');

    await setTitle(dev, '').expect(200);
    expect(await myTitle(dev)).toBeNull();
    await setTitle(dev, 'CTO').expect(200);
    await setTitle(dev, null).expect(200);
    expect(await myTitle(dev)).toBeNull();
  });
});

describe('where others see it', () => {
  it('shows in workspace and project member lists and on the project leads', async () => {
    const { owner, bystander, dev, ws, project } = await projectFixture(t);
    await setTitle(dev, 'Backend developer').expect(200);
    const titleOf = (rows: { user: { id: string; jobTitle: string | null } }[]) =>
      rows.find((r) => r.user.id === dev.id)?.user.jobTitle;

    const workspaceMembers = await bystander.browser
      .get(`/api/v1/workspaces/${ws}/members`)
      .expect(200);
    expect(titleOf(workspaceMembers.body.data)).toBe('Backend developer');

    const projectMembers = await owner.browser
      .get(`/api/v1/projects/${project}/members`)
      .expect(200);
    expect(titleOf(projectMembers.body.data)).toBe('Backend developer');

    await owner.browser
      .patch(`/api/v1/projects/${project}/members/${dev.id}`)
      .send({ role: 'lead' })
      .expect(200);
    const view = (await owner.browser.get(`/api/v1/projects/${project}`).expect(200)).body.data
      .project;
    expect(view.leads).toMatchObject([{ id: dev.id, jobTitle: 'Backend developer' }]);
  });
});

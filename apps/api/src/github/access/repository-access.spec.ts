import {
  activityLogs,
  eq,
  githubInstallations,
  githubRepositories,
  githubWorkspaceConnections,
  githubWorkspaceRepositories,
  outboxEvents,
  projectRepositories,
  projects,
  users,
  workspaces,
  type Database,
} from '@devtrack/database';
import { createTestDatabase } from '@devtrack/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventRecorder } from '../../events/event-recorder.service';
import { RepositoryAccess } from './repository-access.service';

/**
 * RepositoryAccess through its interface, on PGlite, with no GitHub fake (#111). Rows the
 * module doesn't own yet (users, workspaces, projects, installations) are seeded directly.
 */
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let access: RepositoryAccess;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  access = new RepositoryAccess(new EventRecorder());
});
afterAll(async () => {
  await database.close();
});
beforeEach(async () => {
  await database.truncateAll();
});

const GH_INSTALLATION = 111;

async function user(username: string) {
  const [row] = await db
    .insert(users)
    .values({ email: `${username}@example.com`, username })
    .returning();
  return { id: row!.id, username: row!.username };
}

async function installation(status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED' = 'ACTIVE') {
  const [row] = await db
    .insert(githubInstallations)
    .values({
      githubInstallationId: GH_INSTALLATION,
      accountLogin: 'acme-org',
      accountType: 'Organization',
      status,
    })
    .returning();
  return row!;
}

async function repository(installationId: string, githubRepositoryId: number) {
  const [row] = await db
    .insert(githubRepositories)
    .values({
      installationId,
      githubRepositoryId,
      fullName: `acme-org/repo-${githubRepositoryId}`,
      ownerLogin: 'acme-org',
      defaultBranch: 'main',
      visibility: 'private',
    })
    .returning();
  return row!;
}

/** A workspace with one project, optionally connected to the installation. */
async function workspace(
  name: string,
  installationId: string,
  options: { connected?: boolean; key?: string } = {},
) {
  const owner = await user(`${name.toLowerCase()}-owner`);
  const [ws] = await db
    .insert(workspaces)
    .values({ name, slug: name.toLowerCase(), ownerId: owner.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ workspaceId: ws!.id, name: `${name} project`, key: options.key ?? 'DEV' })
    .returning();
  const [connection] =
    options.connected === false
      ? [undefined]
      : await db
          .insert(githubWorkspaceConnections)
          .values({ installationId, workspaceId: ws!.id, connectedBy: owner.id })
          .returning();
  return { owner, workspaceId: ws!.id, project: project!, connection };
}

async function grant(connectionId: string, githubRepositoryId: number) {
  await db.insert(githubWorkspaceRepositories).values({ connectionId, githubRepositoryId });
}

async function link(projectId: string, repositoryId: string) {
  await db.insert(projectRepositories).values({ projectId, repositoryId });
}

/** Installation 111 with repository 1001 granted and linked to project DEV of "Acme". */
async function connectedRepository() {
  const inst = await installation();
  const repo = await repository(inst.id, 1001);
  const acme = await workspace('Acme', inst.id);
  await grant(acme.connection!.id, 1001);
  await link(acme.project.id, repo.id);
  return { inst, repo, acme };
}

const targetIds = async (githubRepositoryId = 1001) =>
  (await access.targets(db, GH_INSTALLATION, githubRepositoryId))?.projects.map((p) => p.id) ??
  null;

describe('targets', () => {
  it('returns the repository and the project it is linked to', async () => {
    const { repo, acme } = await connectedRepository();
    const target = await access.targets(db, GH_INSTALLATION, 1001);
    expect(target?.repo.id).toBe(repo.id);
    expect(target?.projects).toEqual([
      {
        id: acme.project.id,
        workspaceId: acme.workspaceId,
        key: 'DEV',
        chatGithubEvents: acme.project.chatGithubEvents,
      },
    ]);
  });

  it('returns nothing for an unknown repository or installation', async () => {
    await connectedRepository();
    expect(await targetIds(9999)).toBeNull();
    expect(await access.targets(db, 222, 1001)).toBeNull();
  });

  it.each(['SUSPENDED', 'REMOVED'] as const)(
    'returns nothing while the installation is %s',
    async (status) => {
      const { inst } = await connectedRepository();
      await db
        .update(githubInstallations)
        .set({ status })
        .where(eq(githubInstallations.id, inst.id));
      expect(await targetIds()).toBeNull();
    },
  );

  it('leaves out a project whose workspace has no connection', async () => {
    const { inst, repo } = await connectedRepository();
    const other = await workspace('Other', inst.id, { connected: false, key: 'OPS' });
    await link(other.project.id, repo.id);
    expect(await targetIds()).not.toContain(other.project.id);
  });

  it('leaves out a project whose workspace has no grant for the repository', async () => {
    const { inst, repo, acme } = await connectedRepository();
    const other = await workspace('Other', inst.id, { key: 'OPS' });
    await grant(other.connection!.id, 1002);
    await link(other.project.id, repo.id);
    expect(await targetIds()).toEqual([acme.project.id]);
  });

  it('leaves out archived projects', async () => {
    const { acme } = await connectedRepository();
    await db.update(projects).set({ status: 'ARCHIVED' }).where(eq(projects.id, acme.project.id));
    expect(await targetIds()).toBeNull();
  });

  it('reaches every authorized project of a repository shared across workspaces', async () => {
    const { inst, repo, acme } = await connectedRepository();
    // Same project key in a second workspace that granted the same repository.
    const client = await workspace('Client', inst.id, { key: 'DEV' });
    await grant(client.connection!.id, 1001);
    await link(client.project.id, repo.id);
    const ungranted = await workspace('Third', inst.id, { key: 'DEV' });
    await link(ungranted.project.id, repo.id);

    const target = await access.targets(db, GH_INSTALLATION, 1001);
    expect(target?.projects.map((p) => [p.id, p.workspaceId]).sort()).toEqual(
      [
        [acme.project.id, acme.workspaceId],
        [client.project.id, client.workspaceId],
      ].sort(),
    );
  });
});

describe('revokeOnGitHub', () => {
  const disconnectedActivity = () =>
    db.select().from(activityLogs).where(eq(activityLogs.action, 'repository_disconnected'));

  it('removes repository access in every connected workspace and keeps the repository', async () => {
    const { inst, repo, acme } = await connectedRepository();
    const client = await workspace('Client', inst.id, { key: 'WEB' });
    await grant(client.connection!.id, 1001);
    await link(client.project.id, repo.id);
    const other = await repository(inst.id, 1002);
    await grant(acme.connection!.id, 1002);
    await link(acme.project.id, other.id);

    const revoked = await db.transaction((tx) =>
      access.revokeOnGitHub(tx, inst, [1001], 'access_removed'),
    );
    expect(revoked).toBe(1);

    expect(await targetIds(1001)).toBeNull();
    expect(await targetIds(1002)).toEqual([acme.project.id]);
    const [kept] = await db
      .select()
      .from(githubRepositories)
      .where(eq(githubRepositories.id, repo.id));
    expect(kept!.disconnectedAt).toBeInstanceOf(Date);
    const grants = await db.select().from(githubWorkspaceRepositories);
    expect(grants.map((g) => g.githubRepositoryId)).toEqual([1002]);

    const activity = await disconnectedActivity();
    expect(activity.map((a) => a.projectId).sort()).toEqual(
      [acme.project.id, client.project.id].sort(),
    );
    for (const a of activity) {
      expect(a.actorId).toBeNull();
      expect(a.entityType).toBe('project');
      expect(a.metadata).toEqual({
        repository: { id: repo.id, fullName: repo.fullName },
        reason: 'access_removed',
      });
    }
    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'project.repository_disconnected'));
    expect(
      events
        .map((e) => {
          const envelope = e.payload as { projectId: string; payload: unknown };
          return [envelope.projectId, envelope.payload];
        })
        .sort(),
    ).toEqual(
      [
        [acme.project.id, { repositoryId: repo.id }],
        [client.project.id, { repositoryId: repo.id }],
      ].sort(),
    );
  });

  it('reports nothing revoked for repositories DevTrack never connected', async () => {
    const { inst } = await connectedRepository();
    const revoked = await db.transaction((tx) =>
      access.revokeOnGitHub(tx, inst, [4242], 'access_removed'),
    );
    expect(revoked).toBe(0);
    expect(await disconnectedActivity()).toEqual([]);
  });

  it('revokes every repository of an uninstalled installation', async () => {
    const { inst, acme } = await connectedRepository();
    const second = await repository(inst.id, 1002);
    await grant(acme.connection!.id, 1002);
    await link(acme.project.id, second.id);

    await db.transaction((tx) => access.revokeOnGitHub(tx, inst, 'all', 'app_uninstalled'));

    expect(await db.select().from(projectRepositories)).toEqual([]);
    expect(await db.select().from(githubWorkspaceRepositories)).toEqual([]);
    const repos = await db.select().from(githubRepositories);
    expect(repos.every((r) => r.disconnectedAt instanceof Date)).toBe(true);
    const activity = await disconnectedActivity();
    expect(activity).toHaveLength(2);
    expect(
      activity.every((a) => (a.metadata as { reason: string }).reason === 'app_uninstalled'),
    ).toBe(true);
  });
});

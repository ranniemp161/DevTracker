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
  options: { connected?: boolean; key?: string; authorized?: number[] } = {},
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
          .values({
            installationId,
            workspaceId: ws!.id,
            connectedBy: owner.id,
            authorizedRepositoryIds: options.authorized ?? [],
          })
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

describe('connectProject and disconnectProject', () => {
  const verified = (id: number) => ({
    id,
    fullName: `acme-org/repo-${id}`,
    ownerLogin: 'acme-org',
    defaultBranch: 'main',
    visibility: 'private',
  });
  const connectionOf = (inst: { id: string }, w: Awaited<ReturnType<typeof workspace>>) => ({
    id: w.connection!.id,
    workspaceId: w.workspaceId,
    installationId: inst.id,
  });

  /** Installation 111 and workspace Acme with 1001 granted, nothing linked yet. */
  async function granted() {
    const inst = await installation();
    const acme = await workspace('Acme', inst.id);
    await grant(acme.connection!.id, 1001);
    return { inst, acme, connection: connectionOf(inst, acme) };
  }

  it('links a granted repository and records it', async () => {
    const { acme, connection } = await granted();
    const repositoryId = await db.transaction((tx) =>
      access.connectProject(tx, acme.project, connection, verified(1001), acme.owner),
    );
    expect(await targetIds()).toEqual([acme.project.id]);
    const [repo] = await db.select().from(githubRepositories);
    expect(repo).toMatchObject({ id: repositoryId, fullName: 'acme-org/repo-1001' });

    const [activity] = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.action, 'repository_connected'));
    expect(activity).toMatchObject({
      projectId: acme.project.id,
      actorId: acme.owner.id,
      metadata: { repository: { id: repositoryId, fullName: 'acme-org/repo-1001' } },
    });
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'project.repository_connected'));
    expect((event!.payload as { payload: unknown }).payload).toEqual({
      repositoryId,
      githubRepositoryId: 1001,
    });
  });

  it('refuses a repository the workspace has no grant for', async () => {
    const { acme, connection } = await granted();
    await expect(
      db.transaction((tx) =>
        access.connectProject(tx, acme.project, connection, verified(1002), acme.owner),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(projectRepositories)).toEqual([]);
  });

  it("refuses another workspace's connection", async () => {
    const { inst, acme } = await granted();
    const client = await workspace('Client', inst.id, { key: 'WEB' });
    await grant(client.connection!.id, 1001);
    await expect(
      db.transaction((tx) =>
        access.connectProject(
          tx,
          acme.project,
          connectionOf(inst, client),
          verified(1001),
          acme.owner,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(projectRepositories)).toEqual([]);
  });

  it('refuses a project repository that already exists', async () => {
    const { acme, connection } = await granted();
    const connect = () =>
      db.transaction((tx) =>
        access.connectProject(tx, acme.project, connection, verified(1001), acme.owner),
      );
    await connect();
    await expect(connect()).rejects.toMatchObject({
      status: 409,
      code: 'REPOSITORY_ALREADY_CONNECTED',
    });
  });

  it('disconnects, keeps the repository and marks it, and reconnecting clears the mark', async () => {
    const { inst, acme, connection } = await granted();
    const second = await workspace('Second', inst.id, { key: 'MOB' });
    await grant(second.connection!.id, 1001);
    const repositoryId = await db.transaction((tx) =>
      access.connectProject(tx, acme.project, connection, verified(1001), acme.owner),
    );
    await db.transaction((tx) =>
      access.connectProject(
        tx,
        second.project,
        connectionOf(inst, second),
        verified(1001),
        second.owner,
      ),
    );
    const mark = async () => (await db.select().from(githubRepositories))[0]!.disconnectedAt;

    await db.transaction((tx) =>
      access.disconnectProject(tx, acme.project, repositoryId, acme.owner),
    );
    expect(await mark()).toBeNull(); // still linked to the second project
    await db.transaction((tx) =>
      access.disconnectProject(tx, second.project, repositoryId, second.owner),
    );
    expect(await mark()).toBeInstanceOf(Date);
    expect(await db.select().from(githubRepositories)).toHaveLength(1);

    const disconnected = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.action, 'repository_disconnected'));
    expect(disconnected.map((a) => [a.actorId, a.metadata])).toEqual([
      [acme.owner.id, { repository: { id: repositoryId, fullName: 'acme-org/repo-1001' } }],
      [second.owner.id, { repository: { id: repositoryId, fullName: 'acme-org/repo-1001' } }],
    ]);

    const again = await db.transaction((tx) =>
      access.connectProject(tx, acme.project, connection, verified(1001), acme.owner),
    );
    expect(again).toBe(repositoryId);
    expect(await mark()).toBeNull();
  });

  it('refuses to disconnect a repository the project is not linked to', async () => {
    const { acme } = await granted();
    await expect(
      db.transaction((tx) =>
        access.disconnectProject(
          tx,
          acme.project,
          '00000000-0000-4000-8000-000000000000',
          acme.owner,
        ),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('repository grants and workspace disconnect', () => {
  const ref = (inst: { id: string }, w: Awaited<ReturnType<typeof workspace>>) => ({
    id: w.connection!.id,
    workspaceId: w.workspaceId,
    installationId: inst.id,
  });
  const grants = async (connectionId: string) =>
    (
      await db
        .select()
        .from(githubWorkspaceRepositories)
        .where(eq(githubWorkspaceRepositories.connectionId, connectionId))
    )
      .map((g) => g.githubRepositoryId)
      .sort();

  /** Acme's owner last authorized with GitHub and verified 1001 and 1002; 1001 is granted. */
  async function authorized() {
    const inst = await installation();
    const acme = await workspace('Acme', inst.id, { authorized: [1001, 1002] });
    await grant(acme.connection!.id, 1001);
    const admin = await user('acme-admin');
    return { inst, acme, admin, connection: ref(inst, acme) };
  }

  it('lets the last authorizer grant their verified repositories, and others only keep grants', async () => {
    const { acme, admin, connection } = await authorized();
    expect(await access.grantable(db, connection, acme.owner.id)).toEqual({
      granted: [1001],
      grantable: [1001, 1002],
    });
    expect(await access.grantable(db, connection, admin.id)).toEqual({
      granted: [1001],
      grantable: [1001],
    });
  });

  it('refuses a grant outside what the user may grant', async () => {
    const { admin, connection, acme } = await authorized();
    await expect(
      db.transaction((tx) => access.setGrants(tx, connection, [1001, 1002], admin.id, admin)),
    ).rejects.toMatchObject({ status: 403, code: 'GITHUB_INSTALL_NOT_AUTHORIZED' });
    await expect(
      db.transaction((tx) => access.setGrants(tx, connection, [9999], acme.owner.id, acme.owner)),
    ).rejects.toMatchObject({ status: 403 });
    expect(await grants(connection.id)).toEqual([1001]);
  });

  it('saves grants and records the change', async () => {
    const { acme, connection } = await authorized();
    await db.transaction((tx) =>
      access.setGrants(tx, connection, [1001, 1002], acme.owner.id, acme.owner),
    );
    expect(await grants(connection.id)).toEqual([1001, 1002]);
    const [activity] = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.action, 'repository_access_updated'));
    expect(activity).toMatchObject({
      workspaceId: acme.workspaceId,
      projectId: null,
      actorId: acme.owner.id,
      entityType: 'github_installation',
      entityId: connection.id,
      metadata: { account: 'acme-org', repositoryCount: 2 },
    });
  });

  it('removes the project repositories that lose their grant, only in this workspace', async () => {
    const { inst, acme, admin, connection } = await authorized();
    const repo = await repository(inst.id, 1001);
    await link(acme.project.id, repo.id);
    const client = await workspace('Client', inst.id, { key: 'DEV' });
    await grant(client.connection!.id, 1001);
    await link(client.project.id, repo.id);

    // Another admin may still remove grants.
    await db.transaction((tx) => access.setGrants(tx, connection, [], admin.id, admin));

    expect(await targetIds()).toEqual([client.project.id]);
    expect(await grants(client.connection!.id)).toEqual([1001]);
    const [removal] = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.action, 'repository_disconnected'));
    expect(removal).toMatchObject({
      projectId: acme.project.id,
      actorId: null,
      metadata: {
        repository: { id: repo.id, fullName: repo.fullName },
        reason: 'workspace_access_removed',
      },
    });
  });

  it('disconnects only this workspace and records it', async () => {
    const { inst, acme, connection } = await authorized();
    const repo = await repository(inst.id, 1001);
    await link(acme.project.id, repo.id);
    const client = await workspace('Client', inst.id, { key: 'WEB' });
    await grant(client.connection!.id, 1001);
    await link(client.project.id, repo.id);

    await db.transaction((tx) => access.disconnectWorkspace(tx, connection, acme.owner));

    const connections = await db.select().from(githubWorkspaceConnections);
    expect(connections.map((c) => c.id)).toEqual([client.connection!.id]);
    expect(await grants(connection.id)).toEqual([]);
    expect(await targetIds()).toEqual([client.project.id]);
    expect(await db.select().from(githubInstallations)).toHaveLength(1);

    const activity = await db.select().from(activityLogs).orderBy(activityLogs.createdAt);
    expect(activity.map((a) => [a.action, a.projectId, a.actorId])).toEqual([
      ['repository_disconnected', acme.project.id, null],
      ['disconnected', null, acme.owner.id],
    ]);
    expect(activity[1]).toMatchObject({
      entityType: 'github_installation',
      entityId: connection.id,
      metadata: { account: 'acme-org' },
    });
  });
});

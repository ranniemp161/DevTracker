import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('shared-installation migration preserves legacy connections, repository IDs and project history', async () => {
  const db = new PGlite();
  const migrations = new URL('../migrations/', import.meta.url);
  const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrations), 'utf8'));
  try {
    for (const entry of journal.entries.filter((e) => e.idx < 8)) {
      await db.exec(await readFile(new URL(`${entry.tag}.sql`, migrations), 'utf8'));
    }
    const owner = '00000000-0000-4000-8000-000000000001';
    const workspace = '00000000-0000-4000-8000-000000000002';
    const installation = '00000000-0000-4000-8000-000000000003';
    const repository = '00000000-0000-4000-8000-000000000004';
    const project = '00000000-0000-4000-8000-000000000005';
    await db.query('INSERT INTO users (id, email, username) VALUES ($1, $2, $3)', [
      owner,
      'owner@example.com',
      'owner',
    ]);
    await db.query('INSERT INTO workspaces (id, name, slug, owner_id) VALUES ($1, $2, $3, $4)', [
      workspace,
      'Client',
      'client',
      owner,
    ]);
    await db.query('INSERT INTO projects (id, workspace_id, name, key) VALUES ($1, $2, $3, $4)', [
      project,
      workspace,
      'Website',
      'WEB',
    ]);
    await db.query(
      `INSERT INTO github_installations (id, workspace_id, github_installation_id, account_login, account_type, installed_by)
      VALUES ($1, $2, 111, 'agency', 'Organization', $3)`,
      [installation, workspace, owner],
    );
    await db.query(
      `INSERT INTO github_repositories (id, installation_id, github_repository_id, full_name, owner_login, default_branch, visibility)
      VALUES ($1, $2, 1001, 'agency/site', 'agency', 'main', 'private')`,
      [repository, installation],
    );
    await db.query(
      'INSERT INTO project_repositories (project_id, repository_id, connected_by) VALUES ($1, $2, $3)',
      [project, repository, owner],
    );
    await db.query(
      `INSERT INTO github_pull_requests (repository_id, github_pr_id, number, title, url, head_branch, base_branch, state, opened_at, github_updated_at)
      VALUES ($1, 7001, 1, 'Build site', 'https://github.com/agency/site/pull/1', 'feature', 'main', 'open', now(), now())`,
      [repository],
    );

    await db.exec(
      await readFile(new URL('0008_github_workspace_connections.sql', migrations), 'utf8'),
    );
    const { rows: connections } = await db.query(
      'SELECT id, installation_id, workspace_id, connected_by, authorized_repository_ids FROM github_workspace_connections',
    );
    assert.deepEqual(connections, [
      {
        id: installation,
        installation_id: installation,
        workspace_id: workspace,
        connected_by: owner,
        authorized_repository_ids: [1001],
      },
    ]);
    const { rows: grants } = await db.query(
      'SELECT connection_id, github_repository_id::text FROM github_workspace_repositories',
    );
    assert.deepEqual(grants, [{ connection_id: installation, github_repository_id: '1001' }]);
    assert.equal(
      (await db.query('SELECT * FROM project_repositories')).rows[0].repository_id,
      repository,
    );
    assert.equal(
      (await db.query('SELECT * FROM github_pull_requests')).rows[0].repository_id,
      repository,
    );
    assert.equal(
      (await db.query('SELECT * FROM github_installations')).rows[0].workspace_id,
      undefined,
    );

    // Deleting the old workspace must not delete the shared installation or another connection.
    const other = '00000000-0000-4000-8000-000000000006';
    await db.query(
      "INSERT INTO workspaces (id, name, slug, owner_id) VALUES ($1, 'Other', 'other', $2)",
      [other, owner],
    );
    await db.query(
      'INSERT INTO github_workspace_connections (installation_id, workspace_id) VALUES ($1, $2)',
      [installation, other],
    );
    await db.query('DELETE FROM workspaces WHERE id = $1', [workspace]);
    assert.equal((await db.query('SELECT * FROM github_installations')).rows.length, 1);
    assert.equal(
      (await db.query('SELECT * FROM github_workspace_connections')).rows[0].workspace_id,
      other,
    );
    assert.equal((await db.query('SELECT * FROM github_pull_requests')).rows.length, 1);
  } finally {
    await db.close();
  }
});

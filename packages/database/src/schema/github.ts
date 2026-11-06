import {
  bigint,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { projects } from './project.js';
import { workspaces } from './workspace.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** GitHub's numeric IDs fit well inside 2^53, so they are read as JS numbers. */
const githubId = (name: string) => bigint(name, { mode: 'number' });

/**
 * ACTIVE: usable. SUSPENDED: suspended on GitHub (tokens are refused). REMOVED: uninstalled on
 * GitHub. Rows are kept so history stays attached (architecture §11.9, decision record 0005).
 */
export const githubInstallationStatus = pgEnum('github_installation_status', [
  'ACTIVE',
  'SUSPENDED',
  'REMOVED',
]);

/**
 * Architecture §8.2 — a GitHub App installation bound to one workspace. No credentials are
 * stored: installation tokens are minted on demand from the App private key (decision 0005).
 */
export const githubInstallations = pgTable(
  'github_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    githubInstallationId: githubId('github_installation_id').notNull(),
    accountLogin: text('account_login').notNull(),
    /** `User` or `Organization`. */
    accountType: text('account_type').notNull(),
    status: githubInstallationStatus('status').notNull().default('ACTIVE'),
    /** M5 addition: the admin who completed the installation. */
    installedBy: uuid('installed_by').references(() => users.id, { onDelete: 'set null' }),
    installedAt: timestamptz('installed_at').notNull().defaultNow(),
    suspendedAt: timestamptz('suspended_at'),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One installation can never serve two workspaces (cross-tenant repository access).
    unique('github_installations_github_id_unique').on(t.githubInstallationId),
    index('github_installations_workspace_idx').on(t.workspaceId),
  ],
);

/**
 * Architecture §8.2 — a repository an admin has connected to at least one project. Rows are
 * created on first connection and kept after disconnection (history, §7.5). Identity is the
 * stable GitHub numeric ID; names are refreshed from GitHub because they can change (§11.3).
 */
export const githubRepositories = pgTable(
  'github_repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => githubInstallations.id, { onDelete: 'cascade' }),
    githubRepositoryId: githubId('github_repository_id').notNull(),
    fullName: text('full_name').notNull(),
    ownerLogin: text('owner_login').notNull(),
    defaultBranch: text('default_branch').notNull(),
    /** `public`, `private` or `internal`. */
    visibility: text('visibility').notNull(),
    /** First time the repository was connected to a project. */
    connectedAt: timestamptz('connected_at').notNull().defaultNow(),
    /** Set when the last project disconnects it; cleared when connected again. */
    disconnectedAt: timestamptz('disconnected_at'),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('github_repositories_installation_repo_unique').on(
      t.installationId,
      t.githubRepositoryId,
    ),
  ],
);

/**
 * Architecture §8.2 — repository ↔ project. A repository may be connected to several projects
 * of the same workspace (decision 0005); the service checks the workspace matches.
 */
export const projectRepositories = pgTable(
  'project_repositories',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id, { onDelete: 'cascade' }),
    connectedBy: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
    connectedAt: timestamptz('connected_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'project_repositories_pk', columns: [t.projectId, t.repositoryId] }),
    index('project_repositories_repository_idx').on(t.repositoryId),
  ],
);

/**
 * M5 addition — pending GitHub App installation flows. Binds the browser (state cookie), the
 * DevTrack user and the target workspace. Short-lived, single use; only the hash is stored.
 */
export const githubInstallStates = pgTable(
  'github_install_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateHash: text('state_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('github_install_states_state_hash_unique').on(t.stateHash),
    index('github_install_states_expires_at_idx').on(t.expiresAt),
  ],
);

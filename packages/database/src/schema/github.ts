import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
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
import { projects, tasks } from './project.js';
import { workspaces } from './workspace.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Millisecond precision: used in pagination cursors. */
const cursorTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });

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

/** Decision record 0006. IGNORED: valid delivery DevTrack has nothing to do with. */
export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'IGNORED',
  'FAILED',
]);

/**
 * Architecture §8.2/§11.7 — every signed webhook delivery, deduplicated by GitHub's delivery
 * ID. `payload` is kept only until the delivery is processed or ignored (open decision #7,
 * decision 0006); FAILED deliveries keep it for the retry job.
 */
export const githubWebhookDeliveries = pgTable(
  'github_webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliveryId: text('delivery_id').notNull(),
    eventType: text('event_type').notNull(),
    action: text('action'),
    /** GitHub's numeric IDs (the matching DevTrack rows may not exist). */
    githubInstallationId: githubId('github_installation_id'),
    githubRepositoryId: githubId('github_repository_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    processingStatus: webhookDeliveryStatus('processing_status').notNull().default('RECEIVED'),
    attempts: integer('attempts').notNull().default(0),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    lastAttemptAt: timestamptz('last_attempt_at'),
    processedAt: timestamptz('processed_at'),
    /** Short, payload-free description of the last failure. */
    errorMessage: text('error_message'),
  },
  (t) => [
    unique('github_webhook_deliveries_delivery_id_unique').on(t.deliveryId),
    index('github_webhook_deliveries_retry_idx')
      .on(t.processingStatus, t.receivedAt)
      .where(sql`${t.processingStatus} IN ('RECEIVED', 'PROCESSING', 'FAILED')`),
  ],
);

/** Architecture §8.2 — pull requests of connected repositories. */
export const githubPullRequests = pgTable(
  'github_pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id, { onDelete: 'cascade' }),
    githubPrId: githubId('github_pr_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    authorLogin: text('author_login'),
    headBranch: text('head_branch').notNull(),
    baseBranch: text('base_branch').notNull(),
    /** GitHub's `open` / `closed`; merged PRs are `closed` with `merged_at`. */
    state: text('state').notNull(),
    isDraft: boolean('is_draft').notNull().default(false),
    mergedAt: timestamptz('merged_at'),
    closedAt: timestamptz('closed_at'),
    /** GitHub's created/updated times. `github_updated_at` orders out-of-order deliveries. */
    openedAt: cursorTimestamp('opened_at').notNull(),
    githubUpdatedAt: timestamptz('github_updated_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('github_pull_requests_repo_pr_unique').on(t.repositoryId, t.githubPrId),
    index('github_pull_requests_repo_opened_idx').on(t.repositoryId, t.openedAt, t.id),
  ],
);

/** Architecture §8.2 — commits received by push events. */
export const githubCommits = pgTable(
  'github_commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => githubRepositories.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    /** Truncated to 2,000 characters. */
    message: text('message').notNull(),
    authorLogin: text('author_login'),
    authorName: text('author_name'),
    url: text('url').notNull(),
    /** Branch of the push that first delivered this commit. */
    branch: text('branch').notNull(),
    committedAt: timestamptz('committed_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [unique('github_commits_repo_sha_unique').on(t.repositoryId, t.sha)],
);

/** Architecture §8.2 — submitted pull request reviews. */
export const githubReviews = pgTable(
  'github_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pullRequestId: uuid('pull_request_id')
      .notNull()
      .references(() => githubPullRequests.id, { onDelete: 'cascade' }),
    githubReviewId: githubId('github_review_id').notNull(),
    reviewerLogin: text('reviewer_login'),
    /** `approved`, `changes_requested` or `commented`. */
    state: text('state').notNull(),
    url: text('url'),
    submittedAt: timestamptz('submitted_at').notNull(),
  },
  (t) => [unique('github_reviews_pr_review_unique').on(t.pullRequestId, t.githubReviewId)],
);

/** MANUAL: linked by a person. AUTO: a task key was found in the branch name or title. */
export const taskLinkSource = pgEnum('task_link_source', ['MANUAL', 'AUTO']);

/** Architecture §8.2/§11.10 — task ↔ pull request (many-to-many, decision 0006). */
export const taskGithubLinks = pgTable(
  'task_github_links',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    pullRequestId: uuid('pull_request_id')
      .notNull()
      .references(() => githubPullRequests.id, { onDelete: 'cascade' }),
    source: taskLinkSource('source').notNull(),
    /** Null for automatic links. */
    linkedBy: uuid('linked_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'task_github_links_pk', columns: [t.taskId, t.pullRequestId] }),
    index('task_github_links_pull_request_idx').on(t.pullRequestId),
  ],
);

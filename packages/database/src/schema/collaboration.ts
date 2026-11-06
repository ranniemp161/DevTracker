import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { projects, tasks } from './project.js';
import { workspaces } from './workspace.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
/**
 * Millisecond precision for columns used in pagination cursors, so a cursor built from a
 * JavaScript Date matches the stored value exactly.
 */
const cursorTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });

/** Architecture §8.2 — task comments. Soft-deleted (M4 rule 1). */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Plain text; never rendered as HTML. */
    body: text('body').notNull(),
    createdAt: cursorTimestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** Set when the author edits the body. */
    editedAt: timestamptz('edited_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [index('comments_task_created_idx').on(t.taskId, t.createdAt, t.id)],
);

/** Architecture §8.2 — users mentioned in a comment. */
export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    mentionedUserId: uuid('mentioned_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ name: 'comment_mentions_pk', columns: [t.commentId, t.mentionedUserId] })],
);

/**
 * Architecture §8.2 — activity feed. Written in the same transaction as the change it records
 * (§10). `metadata` is minimal and never holds comment/description text or secrets (§8.4).
 * `task_id` (M4 addition) supports the per-task history filter.
 */
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    /** Null for system events (e.g. GitHub, M6). */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: cursorTimestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('activity_logs_project_created_idx').on(t.projectId, t.createdAt, t.id),
    index('activity_logs_task_created_idx').on(t.taskId, t.createdAt, t.id),
  ],
);

/** Architecture §7.7 notification types (pull-request types are emitted from M6). */
export const notificationType = pgEnum('notification_type', [
  'TASK_ASSIGNED',
  'MENTIONED',
  'COMMENT_RECEIVED',
  'PULL_REQUEST_OPENED',
  'PULL_REQUEST_MERGED',
  'PULL_REQUEST_REVIEWED',
  'MILESTONE_COMPLETED',
]);

/** Architecture §8.2 — notifications. `project_id` (M4 addition) lets clients build links. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    readAt: timestamptz('read_at'),
    createdAt: cursorTimestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt, t.id),
    index('notifications_user_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);

/**
 * Architecture §8.2/§10 — transactional outbox. Rows are written with the business change;
 * the M7 publisher delivers them to the real-time layer and sets `published_at`.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: text('event_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    /** The §10 event envelope (without transport details). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    publishedAt: timestamptz('published_at'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    index('outbox_events_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} IS NULL`),
  ],
);

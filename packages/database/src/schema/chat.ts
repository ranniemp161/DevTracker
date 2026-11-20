import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sessions, users } from './identity.js';
import { projects, tasks } from './project.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const chatPushSubscriptions = pgTable(
  'chat_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
  },
  (t) => [index('chat_push_subscriptions_session_idx').on(t.sessionId)],
);

export const chatPushPreferences = pgTable(
  'chat_push_preferences',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['all', 'mentions'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const chatPushDeliveries = pgTable(
  'chat_push_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => projectMessages.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => chatPushSubscriptions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at').notNull().defaultNow(),
  },
  (t) => [
    index('chat_push_deliveries_due_idx').on(t.nextAttemptAt),
    index('chat_push_deliveries_subscription_idx').on(t.subscriptionId),
  ],
);
/**
 * Millisecond precision for timestamp columns.
 */
const cursorTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date', precision: 3 });

/** Architecture §8.2 / Project Chat — project messages. Soft-deleted via `deleted_at`. */
export const projectMessages = pgTable(
  'project_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Plain text; never rendered as HTML. */
    body: text('body').notNull(),
    attachmentName: text('attachment_name'),
    attachmentHash: text('attachment_hash'),
    /** Monotonically increasing per-project sequence. */
    sequence: integer('sequence').notNull(),
    /** Client request ID for idempotent retries. */
    clientRequestId: text('client_request_id').notNull(),
    /** Optional task reference in the same project. */
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdAt: cursorTimestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    editedAt: timestamptz('edited_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    unique('project_messages_project_seq_unique').on(t.projectId, t.sequence),
    unique('project_messages_project_author_client_req_unique').on(
      t.projectId,
      t.authorId,
      t.clientRequestId,
    ),
    index('project_messages_project_seq_idx').on(t.projectId, t.sequence),
    index('project_messages_project_created_idx').on(t.projectId, t.createdAt, t.id),
    index('project_messages_task_id_idx').on(t.taskId),
  ],
);

/** Users mentioned in a project chat message. */
export const projectMessageMentions = pgTable(
  'project_message_mentions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => projectMessages.id, { onDelete: 'cascade' }),
    mentionedUserId: uuid('mentioned_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({
      name: 'project_message_mentions_pk',
      columns: [t.messageId, t.mentionedUserId],
    }),
    index('project_message_mentions_user_idx').on(t.mentionedUserId),
  ],
);

/** Highest acknowledged sequence per project and user. */
export const projectChatReads = pgTable(
  'project_chat_reads',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadSequence: integer('last_read_sequence').notNull().default(0),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'project_chat_reads_pk',
      columns: [t.projectId, t.userId],
    }),
    index('project_chat_reads_user_project_idx').on(t.userId, t.projectId),
  ],
);

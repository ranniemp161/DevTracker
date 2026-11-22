import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  type AnyPgColumn,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { workspaces } from './workspace.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Architecture §7.2 — project statuses. ARCHIVED is set only by DELETE (M3 rule 3). */
export const projectStatus = pgEnum('project_status', [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
]);

/** Architecture §7.3 — task statuses and priorities. */
export const taskStatus = pgEnum('task_status', [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
]);
export const taskPriority = pgEnum('task_priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

/** Architecture §8.2 — projects. */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Immutable; prefixes task keys (`DEV-104`). */
    key: text('key').notNull(),
    description: text('description'),
    status: projectStatus('status').notNull().default('PLANNING'),
    startDate: date('start_date', { mode: 'string' }),
    targetDate: date('target_date', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * M3 (gap 2): next task number to hand out. Incremented under the row lock taken by
     * `UPDATE … RETURNING` inside the task-creation transaction; numbers are never reused.
     */
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    /**
     * M9: next chat message sequence to hand out per project. Incremented under row lock
     * in the message-creation transaction; sequences are strictly linear and monotonic.
     */
    nextMessageSequence: integer('next_message_sequence').notNull().default(1),
    /** 0016: public request form. The token is NULL until the form is first turned on. */
    intakeEnabled: boolean('intake_enabled').notNull().default(false),
    intakeToken: text('intake_token').unique('projects_intake_token_unique'),
    /**
     * 0014: GitHub events posted to the project's chat. Keys are validated by the API
     * (CHAT_GITHUB_EVENTS in @devtrack/types).
     */
    chatGithubEvents: text('chat_github_events')
      .array()
      .notNull()
      .default(
        sql`ARRAY['pull_request.opened','pull_request.merged','review.changes_requested','release.published','checks.failed']::text[]`,
      ),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('projects_workspace_key_unique').on(t.workspaceId, t.key),
    index('projects_workspace_id_idx').on(t.workspaceId),
    check('projects_key_format', sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check(
      'projects_dates_ordered',
      sql`${t.startDate} IS NULL OR ${t.targetDate} IS NULL OR ${t.targetDate} >= ${t.startDate}`,
    ),
  ],
);

/** Architecture §8.2 — project membership (scopes Member access, §6). */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('project_members_project_user_unique').on(t.projectId, t.userId),
    index('project_members_user_id_idx').on(t.userId),
  ],
);

/** Architecture §8.2 — tasks. Soft-deleted via `deleted_at` (M3 rule 5, open decision #6). */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskNumber: integer('task_number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatus('status').notNull().default('TODO'),
    priority: taskPriority('priority').notNull().default('MEDIUM'),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date', { mode: 'string' }),
    /** Expected effort in minutes (record 0012). Compared against logged time entries. */
    estimateMinutes: integer('estimate_minutes'),
    /** Optional deliverable this task counts toward; cleared when the milestone is deleted. */
    milestoneId: uuid('milestone_id').references((): AnyPgColumn => milestones.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Set when the task enters DONE; cleared when it leaves (M3 rule 6). */
    completedAt: timestamptz('completed_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    unique('tasks_project_number_unique').on(t.projectId, t.taskNumber),
    index('tasks_project_status_idx')
      .on(t.projectId, t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index('tasks_milestone_id_idx')
      .on(t.milestoneId)
      .where(sql`${t.deletedAt} IS NULL`),
    check('tasks_estimate_positive', sql`${t.estimateMinutes} IS NULL OR ${t.estimateMinutes} > 0`),
  ],
);

/** Time someone logged against a task (record 0012). Hard-deleted; activity keeps the trail. */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** Who logged it. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    minutes: integer('minutes').notNull(),
    /** The calendar day the work was done. */
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    note: text('note'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('time_entries_task_id_idx').on(t.taskId, t.spentOn),
    check('time_entries_minutes_range', sql`${t.minutes} BETWEEN 1 AND 1440`),
  ],
);

/** Architecture §8.2 — task assignees (many-to-many). */
export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedAt: timestamptz('assigned_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'task_assignees_pk', columns: [t.taskId, t.userId] }),
    index('task_assignees_user_id_idx').on(t.userId),
  ],
);

/** Architecture §8.2 — workspace-scoped labels (M3 addition, approved). */
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** `#rrggbb`. */
    color: text('color').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Names are unique per workspace, case-insensitively.
    uniqueIndex('labels_workspace_name_unique').on(t.workspaceId, sql`lower(${t.name})`),
    check('labels_color_format', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
  ],
);

/** Architecture §8.2 — task ↔ label. */
export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ name: 'task_labels_pk', columns: [t.taskId, t.labelId] }),
    index('task_labels_label_id_idx').on(t.labelId),
  ],
);

export const activeTaskTimers = pgTable('active_task_timers', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  id: uuid('id').notNull().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  startedAt: timestamptz('started_at').notNull().defaultNow(),
  spentOn: date('spent_on', { mode: 'string' }).notNull(),
});

export const milestoneStatus = pgEnum('milestone_status', ['OPEN', 'COMPLETED']);

/** Architecture §8.2 — project milestones (M3 addition, approved). */
export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    dueDate: date('due_date', { mode: 'string' }),
    status: milestoneStatus('status').notNull().default('OPEN'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('milestones_project_id_idx').on(t.projectId)],
);

/** Acceptance criteria: the checklist that defines when a milestone's deliverable is done. */
export const milestoneCriteria = pgTable(
  'milestone_criteria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    /** Display order within the milestone (ascending). */
    position: integer('position').notNull(),
    doneAt: timestamptz('done_at'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('milestone_criteria_milestone_id_idx').on(t.milestoneId, t.position)],
);

/** 0018: a task's checklist (lightweight sub-tasks), in display order. */
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** Display order within the task (ascending). */
    position: integer('position').notNull(),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    doneAt: timestamptz('done_at'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('task_checklist_items_task_idx').on(t.taskId, t.position),
    check('task_checklist_items_body_length', sql`char_length(${t.body}) between 1 and 500`),
  ],
);

/**
 * 0016: a submission from a project's public request form. The task it created holds the
 * title and description; reporter contact details live only here and are deleted on schedule.
 */
export const taskRequests = pgTable(
  'task_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .unique('task_requests_task_unique')
      .references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('new'),
    reporterName: text('reporter_name'),
    reporterEmail: text('reporter_email'),
    contactDeletedAt: timestamptz('contact_deleted_at'),
    triagedBy: uuid('triaged_by').references(() => users.id, { onDelete: 'set null' }),
    triagedAt: timestamptz('triaged_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('task_requests_project_status_idx').on(t.projectId, t.status, t.createdAt),
    check('task_requests_kind_check', sql`${t.kind} IN ('bug', 'request')`),
    check('task_requests_status_check', sql`${t.status} IN ('new', 'accepted', 'declined')`),
  ],
);

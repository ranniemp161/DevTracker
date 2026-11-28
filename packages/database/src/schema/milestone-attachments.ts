import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { milestones } from './project.js';

/** Files that give a milestone's brief its context (0030 §3), shaped like task attachments. */
export const milestoneAttachments = pgTable(
  'milestone_attachments',
  {
    id: uuid('id').primaryKey(),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('milestone_attachments_milestone_id_idx').on(table.milestoneId)],
);

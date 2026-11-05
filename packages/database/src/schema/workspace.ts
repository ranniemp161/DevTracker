import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './identity.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Architecture §6 — workspace roles, highest first. */
export const workspaceRole = pgEnum('workspace_role', ['OWNER', 'ADMIN', 'MEMBER']);

/** Architecture §8.2 — workspaces. The root authorization boundary. */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Generated from the name at creation; immutable. */
    slug: text('slug').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** M2 policy: DELETE archives. Archived workspaces are hidden and read-only. */
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('workspaces_slug_unique').on(t.slug),
    index('workspaces_owner_id_idx').on(t.ownerId),
  ],
);

/** Architecture §8.2 — workspace membership. */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    unique('workspace_members_workspace_user_unique').on(t.workspaceId, t.userId),
    index('workspace_members_user_id_idx').on(t.userId),
    // Exactly one owner per workspace, enforced by the database.
    uniqueIndex('workspace_members_one_owner_idx')
      .on(t.workspaceId)
      .where(sql`${t.role} = 'OWNER'`),
  ],
);

/** Architecture §6/§8.2 — email invitations. Only the token hash is stored. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Normalized (lower-case) invitee email. */
    email: text('email').notNull(),
    role: workspaceRole('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('invitations_token_hash_unique').on(t.tokenHash),
    index('invitations_workspace_id_idx').on(t.workspaceId),
    // At most one open (not accepted, not revoked) invitation per email per workspace.
    uniqueIndex('invitations_one_open_per_email_idx')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check('invitations_role_not_owner', sql`${t.role} <> 'OWNER'`),
    check('invitations_email_normalized', sql`${t.email} = lower(${t.email})`),
  ],
);

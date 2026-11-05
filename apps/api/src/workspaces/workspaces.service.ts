import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  workspaceMembers,
  workspaces,
  type Database,
} from '@devtrack/database';
import type { WorkspaceDetails, WorkspaceSummary } from '@devtrack/types';
import { slugify } from '@devtrack/validators';
import { randomBytes } from 'node:crypto';
import { DATABASE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { WorkspaceAccessService } from './workspace-access.service';
import { toWorkspaceDetails, toWorkspaceSummary } from './workspace.mapper';

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: WorkspaceAccessService,
  ) {}

  /** Creates the workspace and its single OWNER membership in one transaction. */
  async create(userId: string, name: string): Promise<WorkspaceSummary> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const slug = await this.availableSlug(name);
      try {
        const workspace = await this.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(workspaces)
            .values({ name, slug, ownerId: userId })
            .returning();
          await tx
            .insert(workspaceMembers)
            .values({ workspaceId: created!.id, userId, role: 'OWNER' });
          return created!;
        });
        return toWorkspaceSummary(workspace, 'OWNER');
      } catch (err) {
        // Another workspace took the slug between the check and the insert: try again.
        if (isUniqueViolation(err, 'workspaces_slug_unique')) continue;
        throw err;
      }
    }
    throw new Error('Could not allocate a unique workspace slug');
  }

  /** Active workspaces the user belongs to, with their role in each. */
  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const rows = await this.db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.archivedAt)))
      .orderBy(asc(workspaces.name), asc(workspaces.createdAt));
    return rows.map((r) => toWorkspaceSummary(r.workspace, r.role));
  }

  async get(userId: string, workspaceId: string): Promise<WorkspaceDetails> {
    const { workspace, membership } = await this.access.require(userId, workspaceId);
    return toWorkspaceDetails(workspace, membership.role, await this.memberCount(workspace.id));
  }

  /** Admins and the owner can rename. The slug never changes. */
  async rename(userId: string, workspaceId: string, name: string): Promise<WorkspaceDetails> {
    const { membership } = await this.access.require(userId, workspaceId, 'ADMIN');
    const [updated] = await this.db
      .update(workspaces)
      .set({ name })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return toWorkspaceDetails(updated!, membership.role, await this.memberCount(workspaceId));
  }

  /** M2 policy: DELETE archives (owner only). Archived workspaces are hidden and read-only. */
  async archive(userId: string, workspaceId: string): Promise<void> {
    await this.access.require(userId, workspaceId, 'OWNER');
    await this.db
      .update(workspaces)
      .set({ archivedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  private async memberCount(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    return row?.n ?? 0;
  }

  private async availableSlug(name: string): Promise<string> {
    const base = slugify(name);
    const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)];
    const taken = await this.db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(inArray(workspaces.slug, candidates));
    const takenSet = new Set(taken.map((t) => t.slug));
    return candidates.find((c) => !takenSet.has(c)) ?? `${base}-${randomBytes(3).toString('hex')}`;
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq, milestones, sql, type Database } from '@devtrack/database';
import type { Milestone } from '@devtrack/types';
import type { CreateMilestoneInput, UpdateMilestoneInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import {
  ProjectAccessService,
  type ProjectAccessOptions,
} from '../projects/project-access.service';

type MilestoneRow = typeof milestones.$inferSelect;

const toMilestone = (m: MilestoneRow): Milestone => ({
  id: m.id,
  projectId: m.projectId,
  name: m.name,
  description: m.description,
  dueDate: m.dueDate,
  status: m.status,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

/**
 * Project milestones (M3 addition, §8.2 fields). Anyone with project access can read them;
 * workspace Admins/Owner manage them, like project settings. Archived projects are read-only.
 */
@Injectable()
export class MilestonesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
    private readonly events: EventRecorder,
  ) {}

  /** Open milestones first, then by due date (undated last), then name. */
  async list(userId: string, projectId: string): Promise<Milestone[]> {
    await this.access.require(userId, projectId);
    const rows = await this.db
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(
        asc(sql`${milestones.status} = 'COMPLETED'`),
        sql`${milestones.dueDate} asc nulls last`,
        asc(milestones.name),
      );
    return rows.map(toMilestone);
  }

  async create(userId: string, projectId: string, input: CreateMilestoneInput): Promise<Milestone> {
    await this.access.require(userId, projectId, { manage: true });
    const [row] = await this.db
      .insert(milestones)
      .values({
        projectId,
        name: input.name,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
        status: input.status ?? 'OPEN',
      })
      .returning();
    return toMilestone(row!);
  }

  /** Completing a milestone records activity and notifies everyone on the project (M4 rule 5). */
  async update(actor: Actor, milestoneId: string, input: UpdateMilestoneInput): Promise<Milestone> {
    const { milestone, project } = await this.requireMilestone(actor.id, milestoneId, {
      manage: true,
    });
    const completing = input.status === 'COMPLETED' && milestone.status !== 'COMPLETED';

    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(milestones)
        .set({
          name: input.name,
          description: input.description,
          dueDate: input.dueDate,
          status: input.status,
        })
        .where(eq(milestones.id, milestone.id))
        .returning();
      if (completing) {
        await this.events.activity(tx, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          entity: { type: 'milestone', id: milestone.id },
          actor,
          action: 'milestone.completed',
          metadata: { name: updated!.name },
        });
        const audience = await this.access.audience(project, {}, tx);
        await this.events.notify(
          tx,
          actor,
          audience.map((u) => ({
            userId: u.id,
            workspaceId: project.workspaceId,
            projectId: project.id,
            type: 'MILESTONE_COMPLETED' as const,
            title: `Milestone "${updated!.name}" completed in ${project.key}`,
            resourceType: 'milestone',
            resourceId: milestone.id,
          })),
        );
      }
      return updated!;
    });
    return toMilestone(row);
  }

  async remove(userId: string, milestoneId: string): Promise<void> {
    const { milestone } = await this.requireMilestone(userId, milestoneId, { manage: true });
    await this.db.delete(milestones).where(eq(milestones.id, milestone.id));
  }

  private async requireMilestone(userId: string, id: string, options: ProjectAccessOptions) {
    const [milestone] = isUuid(id)
      ? await this.db.select().from(milestones).where(eq(milestones.id, id)).limit(1)
      : [];
    if (!milestone) throw AppException.notFound('Milestone not found.');
    try {
      const { project } = await this.access.require(userId, milestone.projectId, options);
      return { milestone, project };
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw AppException.notFound('Milestone not found.');
      }
      throw err;
    }
  }
}

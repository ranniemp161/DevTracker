import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  milestoneCriteria,
  milestones,
  sql,
  tasks,
  users,
  type Database,
} from '@devtrack/database';
import type { Milestone, MilestoneCriterion, UserRef } from '@devtrack/types';
import type {
  CreateMilestoneCriterionInput,
  CreateMilestoneInput,
  UpdateMilestoneCriterionInput,
  UpdateMilestoneInput,
} from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import {
  ProjectAccessService,
  type ProjectAccessOptions,
} from '../projects/project-access.service';

type MilestoneRow = typeof milestones.$inferSelect;
type CriterionRow = typeof milestoneCriteria.$inferSelect;

const toCriterion = (c: CriterionRow, doneBy: UserRef | null): MilestoneCriterion => ({
  id: c.id,
  milestoneId: c.milestoneId,
  text: c.text,
  done: c.doneAt !== null,
  doneAt: c.doneAt?.toISOString() ?? null,
  doneBy: c.doneAt ? doneBy : null,
});

const toMilestone = (
  m: MilestoneRow,
  taskCounts: Milestone['taskCounts'],
  criteria: MilestoneCriterion[],
): Milestone => ({
  id: m.id,
  projectId: m.projectId,
  name: m.name,
  description: m.description,
  dueDate: m.dueDate,
  status: m.status,
  startedAt: m.startedAt?.toISOString() ?? null,
  deliveredAt: m.deliveredAt?.toISOString() ?? null,
  taskCounts,
  criteria,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

/**
 * 0025 §2: `startedAt` is set on the first entry into Active and never cleared; `deliveredAt`
 * follows Delivered.
 */
function stageTimestamps(
  to: MilestoneRow['status'],
  current: Pick<MilestoneRow, 'startedAt'> | null,
  now: Date,
): Partial<Pick<MilestoneRow, 'startedAt' | 'deliveredAt'>> {
  return {
    ...(to === 'ACTIVE' && !current?.startedAt ? { startedAt: now } : {}),
    deliveredAt: to === 'DELIVERED' ? now : null,
  };
}

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

  /** By stage (Active, Client review, Planned, Delivered), then due date (undated last), then name. */
  async list(userId: string, projectId: string): Promise<Milestone[]> {
    await this.access.require(userId, projectId);
    const rows = await this.db
      .select()
      .from(milestones)
      .where(eq(milestones.projectId, projectId))
      .orderBy(
        asc(
          sql`case ${milestones.status} when 'ACTIVE' then 0 when 'CLIENT_REVIEW' then 1 when 'PLANNED' then 2 else 3 end`,
        ),
        sql`${milestones.dueDate} asc nulls last`,
        asc(milestones.name),
      );
    return this.hydrate(rows);
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
        ...stageTimestamps(input.status ?? 'PLANNED', null, new Date()),
        status: input.status ?? 'PLANNED',
      })
      .returning();
    return (await this.hydrate([row!]))[0]!;
  }

  /**
   * A stage change records activity (0025 §2). Delivering also records `milestone.completed` and
   * notifies everyone on the project, as completing did (M4 rule 5).
   */
  async update(actor: Actor, milestoneId: string, input: UpdateMilestoneInput): Promise<Milestone> {
    const { milestone, project } = await this.requireMilestone(actor.id, milestoneId, {
      manage: true,
    });
    const moving = input.status !== undefined && input.status !== milestone.status;
    const completing = moving && input.status === 'DELIVERED';

    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(milestones)
        .set({
          name: input.name,
          description: input.description,
          dueDate: input.dueDate,
          status: input.status,
          ...(moving ? stageTimestamps(input.status!, milestone, new Date()) : {}),
        })
        .where(eq(milestones.id, milestone.id))
        .returning();
      // Delivering is recorded as `milestone.completed` below, so the feed shows it once.
      if (moving && !completing) {
        await this.events.activity(tx, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          entity: { type: 'milestone', id: milestone.id },
          actor,
          action: 'milestone.stage_changed',
          metadata: { name: updated!.name, stage: { from: milestone.status, to: input.status } },
        });
      }
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
            title: `Milestone "${updated!.name}" delivered in ${project.key}`,
            resourceType: 'milestone',
            resourceId: milestone.id,
          })),
        );
      }
      return updated!;
    });
    return (await this.hydrate([row]))[0]!;
  }

  async remove(userId: string, milestoneId: string): Promise<void> {
    const { milestone } = await this.requireMilestone(userId, milestoneId, { manage: true });
    await this.db.delete(milestones).where(eq(milestones.id, milestone.id));
  }

  /** Appends a criterion to the end of the milestone's checklist. */
  async addCriterion(
    userId: string,
    milestoneId: string,
    input: CreateMilestoneCriterionInput,
  ): Promise<Milestone> {
    const { milestone } = await this.requireMilestone(userId, milestoneId, {
      manage: true,
      write: true,
    });
    const [last] = await this.db
      .select({ position: milestoneCriteria.position })
      .from(milestoneCriteria)
      .where(eq(milestoneCriteria.milestoneId, milestone.id))
      .orderBy(sql`${milestoneCriteria.position} desc`)
      .limit(1);
    await this.db.insert(milestoneCriteria).values({
      milestoneId: milestone.id,
      text: input.text,
      position: (last?.position ?? -1) + 1,
    });
    return (await this.hydrate([milestone]))[0]!;
  }

  /** Edits the text and/or checks or unchecks a criterion, recording who checked it. */
  async updateCriterion(
    userId: string,
    criterionId: string,
    input: UpdateMilestoneCriterionInput,
  ): Promise<Milestone> {
    const { criterion, milestone } = await this.requireCriterion(userId, criterionId);
    const checking = input.done === true && criterion.doneAt === null;
    const unchecking = input.done === false && criterion.doneAt !== null;
    if (input.text !== undefined || checking || unchecking) {
      await this.db
        .update(milestoneCriteria)
        .set({
          text: input.text,
          ...(checking ? { doneAt: new Date(), doneBy: userId } : {}),
          ...(unchecking ? { doneAt: null, doneBy: null } : {}),
        })
        .where(eq(milestoneCriteria.id, criterion.id));
    }
    return (await this.hydrate([milestone]))[0]!;
  }

  async removeCriterion(userId: string, criterionId: string): Promise<Milestone> {
    const { criterion, milestone } = await this.requireCriterion(userId, criterionId);
    await this.db.delete(milestoneCriteria).where(eq(milestoneCriteria.id, criterion.id));
    return (await this.hydrate([milestone]))[0]!;
  }

  /** Adds real task counts (non-deleted tasks only) and ordered criteria to milestone rows. */
  private async hydrate(rows: MilestoneRow[]): Promise<Milestone[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((m) => m.id);
    const counts = await this.db
      .select({
        milestoneId: tasks.milestoneId,
        total: count(),
        done: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')`.mapWith(Number),
      })
      .from(tasks)
      .where(and(inArray(tasks.milestoneId, ids), isNull(tasks.deletedAt)))
      .groupBy(tasks.milestoneId);
    const criteria = await this.db
      .select({
        criterion: milestoneCriteria,
        doneBy: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
      })
      .from(milestoneCriteria)
      .leftJoin(users, eq(users.id, milestoneCriteria.doneBy))
      .where(inArray(milestoneCriteria.milestoneId, ids))
      .orderBy(asc(milestoneCriteria.position), asc(milestoneCriteria.createdAt));

    const countsById = new Map(counts.map((c) => [c.milestoneId, c]));
    const criteriaById = new Map<string, MilestoneCriterion[]>();
    for (const c of criteria) {
      const list = criteriaById.get(c.criterion.milestoneId) ?? [];
      list.push(toCriterion(c.criterion, c.doneBy));
      criteriaById.set(c.criterion.milestoneId, list);
    }
    return rows.map((m) => {
      const c = countsById.get(m.id);
      return toMilestone(
        m,
        { total: c?.total ?? 0, done: c?.done ?? 0 },
        criteriaById.get(m.id) ?? [],
      );
    });
  }

  private async requireCriterion(userId: string, id: string) {
    const [criterion] = isUuid(id)
      ? await this.db.select().from(milestoneCriteria).where(eq(milestoneCriteria.id, id)).limit(1)
      : [];
    if (!criterion) throw AppException.notFound('Criterion not found.');
    try {
      const { milestone } = await this.requireMilestone(userId, criterion.milestoneId, {
        manage: true,
        write: true,
      });
      return { criterion, milestone };
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw AppException.notFound('Criterion not found.');
      }
      throw err;
    }
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

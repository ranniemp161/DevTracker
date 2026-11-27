import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  githubReleases,
  githubRepositories,
  inArray,
  isNull,
  milestoneCriteria,
  milestoneGithubReleases,
  milestones,
  ne,
  projectMembers,
  projectRepositories,
  projects,
  sql,
  tasks,
  users,
  type Database,
} from '@devtrack/database';
import { ErrorCode } from '@devtrack/types';
import type {
  GithubRelease,
  LinkedMilestoneRelease,
  Milestone,
  MilestoneCriterion,
  UserRef,
  WorkspaceOverview,
} from '@devtrack/types';
import { hasAtLeastRole } from '@devtrack/server-core';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import type {
  CreateMilestoneCriterionInput,
  CreateMilestoneInput,
  UpdateMilestoneCriterionInput,
  UpdateMilestoneInput,
} from '@devtrack/validators';
import { ClientUpdatesService } from '../client-updates/client-updates.service';
import { AppException } from '../common/errors/app.exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import {
  ProjectAccessService,
  type ProjectAccessOptions,
} from '../projects/project-access.service';
import { MilestoneReadinessService } from './milestone-readiness.service';

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
  releases: LinkedMilestoneRelease[],
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
  releases,
  clientApproval: m.clientApprovedAt
    ? {
        at: m.clientApprovedAt.toISOString(),
        name: m.clientApprovedName,
        note: m.clientApprovedNote,
      }
    : null,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

const releaseFields = {
  id: githubReleases.id,
  tagName: githubReleases.tagName,
  name: githubReleases.name,
  url: githubReleases.url,
  prerelease: githubReleases.prerelease,
  publishedAt: githubReleases.publishedAt,
  repository: githubRepositories.fullName,
};

const toRelease = (r: {
  id: string;
  tagName: string;
  name: string | null;
  url: string;
  prerelease: boolean;
  publishedAt: Date;
  repository: string;
}): GithubRelease => ({ ...r, publishedAt: r.publishedAt.toISOString() });

/** Activity metadata for a release link (0026): names and links, never ids alone. */
export function releaseActivity(
  milestoneName: string,
  release: { tagName: string; name: string | null; url: string; repository: string },
  source: 'MANUAL' | 'AUTO',
) {
  return {
    name: milestoneName,
    release: {
      tag: release.tagName,
      name: release.name,
      url: release.url,
      repository: release.repository,
    },
    source,
  };
}

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
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly clientUpdates: ClientUpdatesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: EventRecorder,
    private readonly readiness: MilestoneReadinessService,
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
      if (moving) await this.readiness.sync(tx, actor, project, [milestone.id]);
      return updated!;
    });
    // 0028 §2: clients whose requests were in it hear it was delivered.
    if (completing) await this.clientUpdates.milestoneDelivered(milestone.id);
    return (await this.hydrate([row]))[0]!;
  }

  /**
   * 0027: undelivered milestones across the workspace for its admins (every unarchived project)
   * and project leads (their projects only). Anyone else is refused.
   */
  async overview(userId: string, workspaceId: string): Promise<WorkspaceOverview> {
    const { membership } = await this.workspaceAccess.require(userId, workspaceId);
    const admin = hasAtLeastRole(membership.role, 'ADMIN');
    const visible = await this.db
      .select({ id: projects.id, key: projects.key, name: projects.name })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          ne(projects.status, 'ARCHIVED'),
          admin
            ? undefined
            : inArray(
                projects.id,
                this.db
                  .select({ id: projectMembers.projectId })
                  .from(projectMembers)
                  .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, 'lead'))),
              ),
        ),
      )
      .orderBy(asc(projects.name));
    if (!admin && visible.length === 0) {
      throw AppException.forbidden('The overview is for workspace admins and project leads.');
    }
    const rows =
      visible.length === 0
        ? []
        : await this.db
            .select()
            .from(milestones)
            .where(
              and(
                inArray(
                  milestones.projectId,
                  visible.map((p) => p.id),
                ),
                ne(milestones.status, 'DELIVERED'),
              ),
            );
    const hydrated = await this.hydrate(rows);
    const today = new Date().toISOString().slice(0, 10);
    // Overdue first, then by due date (undated last), then name.
    const rank = (m: Milestone) => (m.dueDate !== null && m.dueDate < today ? 0 : 1);
    hydrated.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
        a.name.localeCompare(b.name),
    );
    const stages = ['ACTIVE', 'CLIENT_REVIEW', 'PLANNED'] as const;
    return {
      sections: stages
        .map((stage) => ({
          stage,
          projects: visible
            .map((project) => ({
              project,
              milestones: hydrated.filter((m) => m.projectId === project.id && m.status === stage),
            }))
            .filter((g) => g.milestones.length > 0),
        }))
        .filter((s) => s.projects.length > 0),
    };
  }

  /**
   * 0028 §3: the client's private sign-off link, for leads and admins while the milestone is in
   * Client review. `replace` makes a new link, and the old one stops working at once.
   */
  async signoffLink(actor: Actor, milestoneId: string, replace: boolean): Promise<{ url: string }> {
    const { milestone } = await this.requireMilestone(actor.id, milestoneId, {
      manage: true,
      write: true,
    });
    if (milestone.status !== 'CLIENT_REVIEW') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'Move the milestone to Client review to share a sign-off link.',
      );
    }
    let token = milestone.signoffToken;
    if (!token || replace) {
      token = randomBytes(32).toString('base64url');
      await this.db
        .update(milestones)
        .set({ signoffToken: token })
        .where(eq(milestones.id, milestone.id));
    }
    return { url: `${this.config.webOrigin}/s/${token}` };
  }

  /** 0026 §4: releases of the repositories connected to the project, newest first. */
  async releases(userId: string, projectId: string): Promise<GithubRelease[]> {
    await this.access.require(userId, projectId);
    const rows = await this.db
      .select(releaseFields)
      .from(githubReleases)
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubReleases.repositoryId))
      .innerJoin(
        projectRepositories,
        and(
          eq(projectRepositories.repositoryId, githubReleases.repositoryId),
          eq(projectRepositories.projectId, projectId),
        ),
      )
      .orderBy(desc(githubReleases.publishedAt), asc(githubReleases.tagName))
      .limit(100);
    return rows.map(toRelease);
  }

  /** 0026 §4: display only; linking never moves the milestone's stage. */
  async linkRelease(actor: Actor, milestoneId: string, releaseId: string): Promise<Milestone> {
    const { milestone, project } = await this.requireMilestone(actor.id, milestoneId, {
      manage: true,
      write: true,
    });
    const [release] = await this.db
      .select(releaseFields)
      .from(githubReleases)
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubReleases.repositoryId))
      .innerJoin(
        projectRepositories,
        and(
          eq(projectRepositories.repositoryId, githubReleases.repositoryId),
          eq(projectRepositories.projectId, project.id),
        ),
      )
      .where(eq(githubReleases.id, releaseId))
      .limit(1);
    if (!release) {
      throw AppException.notFound("This release isn't from a repository connected to the project.");
    }
    await this.db.transaction(async (tx) => {
      const added = await tx
        .insert(milestoneGithubReleases)
        .values({ milestoneId: milestone.id, releaseId, source: 'MANUAL', linkedBy: actor.id })
        .onConflictDoNothing()
        .returning({ releaseId: milestoneGithubReleases.releaseId });
      if (added.length === 0) return;
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        entity: { type: 'milestone', id: milestone.id },
        actor,
        action: 'milestone.release_linked',
        metadata: releaseActivity(milestone.name, release, 'MANUAL'),
      });
    });
    return (await this.hydrate([milestone]))[0]!;
  }

  async unlinkRelease(actor: Actor, milestoneId: string, releaseId: string): Promise<Milestone> {
    const { milestone, project } = await this.requireMilestone(actor.id, milestoneId, {
      manage: true,
      write: true,
    });
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(milestoneGithubReleases)
        .where(
          and(
            eq(milestoneGithubReleases.milestoneId, milestone.id),
            eq(milestoneGithubReleases.releaseId, releaseId),
          ),
        )
        .returning({ source: milestoneGithubReleases.source });
      if (removed.length === 0) {
        throw AppException.notFound('This release is not linked to the milestone.');
      }
      const [release] = await tx
        .select(releaseFields)
        .from(githubReleases)
        .innerJoin(githubRepositories, eq(githubRepositories.id, githubReleases.repositoryId))
        .where(eq(githubReleases.id, releaseId));
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        entity: { type: 'milestone', id: milestone.id },
        actor,
        action: 'milestone.release_unlinked',
        metadata: releaseActivity(milestone.name, release!, removed[0]!.source),
      });
    });
    return (await this.hydrate([milestone]))[0]!;
  }

  async remove(userId: string, milestoneId: string): Promise<void> {
    const { milestone } = await this.requireMilestone(userId, milestoneId, { manage: true });
    await this.db.delete(milestones).where(eq(milestones.id, milestone.id));
  }

  /** Appends a criterion to the end of the milestone's checklist. */
  async addCriterion(
    actor: Actor,
    milestoneId: string,
    input: CreateMilestoneCriterionInput,
  ): Promise<Milestone> {
    const { milestone, project } = await this.requireMilestone(actor.id, milestoneId, {
      manage: true,
      write: true,
    });
    await this.db.transaction(async (tx) => {
      const [last] = await tx
        .select({ position: milestoneCriteria.position })
        .from(milestoneCriteria)
        .where(eq(milestoneCriteria.milestoneId, milestone.id))
        .orderBy(sql`${milestoneCriteria.position} desc`)
        .limit(1);
      await tx.insert(milestoneCriteria).values({
        milestoneId: milestone.id,
        text: input.text,
        position: (last?.position ?? -1) + 1,
      });
      await this.readiness.sync(tx, actor, project, [milestone.id]);
    });
    return (await this.hydrate([milestone]))[0]!;
  }

  /** Edits the text and/or checks or unchecks a criterion, recording who checked it. */
  async updateCriterion(
    actor: Actor,
    criterionId: string,
    input: UpdateMilestoneCriterionInput,
  ): Promise<Milestone> {
    const { criterion, milestone, project } = await this.requireCriterion(actor.id, criterionId);
    const checking = input.done === true && criterion.doneAt === null;
    const unchecking = input.done === false && criterion.doneAt !== null;
    if (input.text !== undefined || checking || unchecking) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(milestoneCriteria)
          .set({
            text: input.text,
            ...(checking ? { doneAt: new Date(), doneBy: actor.id } : {}),
            ...(unchecking ? { doneAt: null, doneBy: null } : {}),
          })
          .where(eq(milestoneCriteria.id, criterion.id));
        if (checking || unchecking) {
          await this.readiness.sync(tx, actor, project, [milestone.id]);
        }
      });
    }
    return (await this.hydrate([milestone]))[0]!;
  }

  async removeCriterion(actor: Actor, criterionId: string): Promise<Milestone> {
    const { criterion, milestone, project } = await this.requireCriterion(actor.id, criterionId);
    await this.db.transaction(async (tx) => {
      await tx.delete(milestoneCriteria).where(eq(milestoneCriteria.id, criterion.id));
      await this.readiness.sync(tx, actor, project, [milestone.id]);
    });
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
        // 0025 §3: joined after the milestone first became Active.
        addedAfterStart:
          sql<number>`count(*) filter (where ${milestones.startedAt} is not null and ${tasks.milestoneAddedAt} > ${milestones.startedAt})`.mapWith(
            Number,
          ),
      })
      .from(tasks)
      .innerJoin(milestones, eq(milestones.id, tasks.milestoneId))
      .where(and(inArray(tasks.milestoneId, ids), isNull(tasks.deletedAt)))
      .groupBy(tasks.milestoneId, milestones.startedAt);
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
    const linked = await this.db
      .select({
        milestoneId: milestoneGithubReleases.milestoneId,
        source: milestoneGithubReleases.source,
        ...releaseFields,
      })
      .from(milestoneGithubReleases)
      .innerJoin(githubReleases, eq(githubReleases.id, milestoneGithubReleases.releaseId))
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubReleases.repositoryId))
      .where(inArray(milestoneGithubReleases.milestoneId, ids))
      .orderBy(desc(githubReleases.publishedAt), asc(githubReleases.tagName));
    const releasesById = new Map<string, LinkedMilestoneRelease[]>();
    for (const { milestoneId, source, ...r } of linked) {
      releasesById.set(milestoneId, [
        ...(releasesById.get(milestoneId) ?? []),
        { ...toRelease(r), source },
      ]);
    }
    return rows.map((m) => {
      const c = countsById.get(m.id);
      return toMilestone(
        m,
        { total: c?.total ?? 0, done: c?.done ?? 0, addedAfterStart: c?.addedAfterStart ?? 0 },
        criteriaById.get(m.id) ?? [],
        releasesById.get(m.id) ?? [],
      );
    });
  }

  private async requireCriterion(userId: string, id: string) {
    const [criterion] = isUuid(id)
      ? await this.db.select().from(milestoneCriteria).where(eq(milestoneCriteria.id, id)).limit(1)
      : [];
    if (!criterion) throw AppException.notFound('Criterion not found.');
    try {
      const { milestone, project } = await this.requireMilestone(userId, criterion.milestoneId, {
        manage: true,
        write: true,
      });
      return { criterion, milestone, project };
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

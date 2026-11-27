import { Injectable } from '@nestjs/common';
import {
  and,
  count,
  eq,
  isNull,
  milestoneCriteria,
  milestones,
  sql,
  tasks,
  type Executor,
} from '@devtrack/database';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService } from '../projects/project-access.service';

/**
 * 0025 §4: tracks whether an Active milestone has all tasks Done and all acceptance criteria
 * ticked, and notifies the people who answer for the project once per readiness transition.
 */
@Injectable()
export class MilestoneReadinessService {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly events: EventRecorder,
  ) {}

  async sync(
    tx: Executor,
    actor: Actor | null,
    project: { id: string; key: string; workspaceId: string },
    milestoneIds: (string | null | undefined)[],
  ): Promise<void> {
    const ids = [...new Set(milestoneIds.filter((id): id is string => Boolean(id)))];
    for (const id of ids) {
      const [milestone] = await tx
        .select({
          id: milestones.id,
          name: milestones.name,
          status: milestones.status,
          readyNotifiedAt: milestones.readyNotifiedAt,
        })
        .from(milestones)
        .where(eq(milestones.id, id))
        .limit(1);
      if (!milestone) continue;

      const ready =
        milestone.status === 'ACTIVE' && (await this.allDoneAndCriteriaMet(tx, milestone.id));

      if (ready && !milestone.readyNotifiedAt) {
        await tx
          .update(milestones)
          .set({ readyNotifiedAt: new Date() })
          .where(eq(milestones.id, milestone.id));
        const people = await this.access.responsible(project, tx);
        await this.events.notify(
          tx,
          actor,
          people.map(({ id: userId }) => ({
            userId,
            workspaceId: project.workspaceId,
            projectId: project.id,
            type: 'MILESTONE_READY' as const,
            title: `Milestone "${milestone.name}" is ready for Client review in ${project.key}`,
            body: 'All tasks are done and all acceptance criteria are met.',
            resourceType: 'milestone',
            resourceId: milestone.id,
          })),
        );
      } else if (!ready && milestone.readyNotifiedAt) {
        await tx
          .update(milestones)
          .set({ readyNotifiedAt: null })
          .where(eq(milestones.id, milestone.id));
      }
    }
  }

  private async allDoneAndCriteriaMet(tx: Executor, milestoneId: string): Promise<boolean> {
    const [taskRow] = await tx
      .select({
        total: count(),
        undone: sql<number>`count(*) filter (where ${tasks.status} <> 'DONE')`.mapWith(Number),
      })
      .from(tasks)
      .where(and(eq(tasks.milestoneId, milestoneId), isNull(tasks.deletedAt)));
    if ((taskRow?.total ?? 0) === 0 || (taskRow?.undone ?? 0) > 0) return false;

    const [unticked] = await tx
      .select({ id: milestoneCriteria.id })
      .from(milestoneCriteria)
      .where(and(eq(milestoneCriteria.milestoneId, milestoneId), isNull(milestoneCriteria.doneAt)))
      .limit(1);
    return !unticked;
  }
}

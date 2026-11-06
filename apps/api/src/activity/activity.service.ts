import { Injectable, Inject } from '@nestjs/common';
import { activityLogs, and, desc, eq, sql, tasks, users, type Database } from '@devtrack/database';
import type { ActivityAction, ActivityEntry } from '@devtrack/types';
import type { ListActivityQuery } from '@devtrack/validators';
import { decodeCursor, isTimeCursor, Paginated, timeCursorOf } from '../common/http/paginated';
import { DATABASE } from '../database/database.module';
import { ProjectAccessService } from '../projects/project-access.service';

/** Project activity feed (architecture §7.6): newest first, scoped by project access. */
@Injectable()
export class ActivityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
  ) {}

  async list(
    userId: string,
    projectId: string,
    query: ListActivityQuery,
  ): Promise<Paginated<ActivityEntry>> {
    const { project } = await this.access.require(userId, projectId);
    const before = query.cursor ? decodeCursor(query.cursor, isTimeCursor) : null;

    const rows = await this.db
      .select({
        log: activityLogs,
        actor: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
        task: { id: tasks.id, number: tasks.taskNumber, title: tasks.title },
      })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .leftJoin(tasks, eq(tasks.id, activityLogs.taskId))
      .where(
        and(
          eq(activityLogs.projectId, project.id),
          query.taskId ? eq(activityLogs.taskId, query.taskId.toLowerCase()) : undefined,
          before
            ? sql`(${activityLogs.createdAt}, ${activityLogs.id}) < (${before.t}::timestamptz, ${before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? timeCursorOf(page.at(-1)!.log) : null;
    return new Paginated(
      page.map(({ log, actor, task }) => ({
        id: log.id,
        action: `${log.entityType}.${log.action}` as ActivityAction,
        actor,
        projectId: log.projectId,
        task: task
          ? { id: task.id, key: `${project.key}-${task.number}`, title: task.title }
          : null,
        entity: { type: log.entityType, id: log.entityId },
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      })),
      nextCursor,
    );
  }
}

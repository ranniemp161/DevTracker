import { Injectable, Inject } from '@nestjs/common';
import {
  activityLogs,
  and,
  desc,
  eq,
  inArray,
  or,
  sql,
  tasks,
  users,
  type Database,
} from '@devtrack/database';
import type { ActivityAction, ActivityEntry } from '@devtrack/types';
import type { ActivityCategory, ListActivityQuery } from '@devtrack/validators';
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
    query: Pick<ListActivityQuery, 'cursor' | 'limit' | 'category'> & { taskId?: string },
    filter: { entityTypes?: string[] } = {},
  ): Promise<Paginated<ActivityEntry>> {
    const { project } = await this.access.require(userId, projectId);
    const before = query.cursor ? decodeCursor(query.cursor, isTimeCursor) : null;

    const rows = await this.db
      .select(activityRowFields)
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .leftJoin(tasks, eq(tasks.id, activityLogs.taskId))
      .where(
        and(
          eq(activityLogs.projectId, project.id),
          query.taskId ? eq(activityLogs.taskId, query.taskId.toLowerCase()) : undefined,
          filter.entityTypes ? inArray(activityLogs.entityType, filter.entityTypes) : undefined,
          query.category ? categoryCondition(query.category) : undefined,
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
      page.map((row) => toActivityEntry(row, project.key)),
      nextCursor,
    );
  }
}

/**
 * Which events each Activity filter chip shows (decision record 0004). Project created, updated
 * and archived events appear only under "All".
 */
function categoryCondition(category: ActivityCategory) {
  const projectAction = (actions: string[]) =>
    and(eq(activityLogs.entityType, 'project'), inArray(activityLogs.action, actions));
  switch (category) {
    case 'tasks':
      return inArray(activityLogs.entityType, ['task', 'milestone']);
    case 'comments':
      return eq(activityLogs.entityType, 'comment');
    case 'repository':
      return or(
        inArray(activityLogs.entityType, ['pull_request', 'repository']),
        projectAction(['repository_connected', 'repository_disconnected']),
      );
    case 'members':
      return projectAction(['member_added', 'member_removed']);
  }
}

/** Columns `toActivityEntry` needs; join `users` (actor) and `tasks` (task) as left joins. */
export const activityRowFields = {
  log: activityLogs,
  actor: { id: users.id, username: users.username, avatarUrl: users.avatarUrl },
  task: { id: tasks.id, number: tasks.taskNumber, title: tasks.title },
};

interface ActivityRow {
  log: typeof activityLogs.$inferSelect;
  actor: ActivityEntry['actor'];
  task: { id: string; number: number; title: string } | null;
}

/** Shared by the project feed and the task timeline, so both describe events the same way. */
export function toActivityEntry(
  { log, actor, task }: ActivityRow,
  projectKey: string,
): ActivityEntry {
  return {
    id: log.id,
    action: `${log.entityType}.${log.action}` as ActivityAction,
    actor,
    projectId: log.projectId,
    task: task ? { id: task.id, key: `${projectKey}-${task.number}`, title: task.title } : null,
    entity: { type: log.entityType, id: log.entityId },
    metadata: log.metadata,
    createdAt: log.createdAt.toISOString(),
  };
}

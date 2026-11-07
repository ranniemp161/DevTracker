import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notifications,
  sql,
  workspaceMembers,
  workspaces,
  type Database,
  type SQL,
} from '@devtrack/database';
import type { Notification } from '@devtrack/types';
import type { ListNotificationsQuery } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { decodeCursor, isTimeCursor, Paginated, timeCursorOf } from '../common/http/paginated';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';

type NotificationRow = typeof notifications.$inferSelect;

function linkFor(n: NotificationRow): string | null {
  if (!n.projectId) return null;
  if (n.resourceType === 'task') return `/projects/${n.projectId}/tasks/${n.resourceId}`;
  if (n.resourceType === 'milestone') return `/projects/${n.projectId}/milestones`;
  if (n.resourceType === 'chat_message')
    return `/projects/${n.projectId}/chat?message=${n.resourceId}`;
  return `/projects/${n.projectId}`;
}

const toNotification = (n: NotificationRow): Notification => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  workspaceId: n.workspaceId,
  projectId: n.projectId,
  resourceType: n.resourceType,
  resourceId: n.resourceId,
  link: linkFor(n),
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/**
 * The signed-in user's notifications (architecture §7.7). Only notifications from active
 * workspaces the user still belongs to are visible (M4 rule 5), so people who leave stop
 * seeing task titles from that workspace.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly events: EventRecorder,
  ) {}

  async list(userId: string, query: ListNotificationsQuery): Promise<Paginated<Notification>> {
    const before = query.cursor ? decodeCursor(query.cursor, isTimeCursor) : null;
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          ...this.visible(userId),
          query.unreadOnly ? isNull(notifications.readAt) : undefined,
          before
            ? sql`(${notifications.createdAt}, ${notifications.id}) < (${before.t}::timestamptz, ${before.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? timeCursorOf(page.at(-1)!) : null;
    return new Paginated(page.map(toNotification), nextCursor);
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(...this.visible(userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  }

  async markRead(actor: Actor, notificationId: string): Promise<Notification> {
    if (!isUuid(notificationId)) throw notFound();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, notificationId), ...this.visible(actor.id)))
        .returning();
      if (!row) throw notFound(); // someone else's notification looks nonexistent
      await this.events.event(
        tx,
        'notification.read',
        {
          workspaceId: row.workspaceId,
          projectId: row.projectId,
          actor,
          entity: { type: 'user', id: actor.id },
        },
        { notificationIds: [row.id] },
      );
      return toNotification(row);
    });
  }

  async markAllRead(actor: Actor): Promise<{ updated: number }> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.userId, actor.id), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      if (updated.length > 0) {
        await this.events.event(
          tx,
          'notification.read',
          { workspaceId: null, projectId: null, actor, entity: { type: 'user', id: actor.id } },
          { all: true },
        );
      }
      return { updated: updated.length };
    });
  }

  /** Own notifications from active workspaces the user is still a member of. */
  private visible(userId: string): SQL[] {
    return [
      eq(notifications.userId, userId),
      inArray(
        notifications.workspaceId,
        this.db
          .select({ id: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
          .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.archivedAt))),
      ),
      sql`(${notifications.resourceType} != 'chat_message' OR ${notifications.projectId} IN (
        SELECT p.id FROM projects p
        INNER JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ${userId}
        LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
        WHERE wm.role IN ('OWNER', 'ADMIN') OR pm.user_id IS NOT NULL
      ))`,
    ];
  }
}

const notFound = () => AppException.notFound('Notification not found.');

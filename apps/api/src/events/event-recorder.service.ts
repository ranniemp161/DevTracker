import { Injectable } from '@nestjs/common';
import { activityLogs, notifications, outboxEvents, type Executor } from '@devtrack/database';
import type { ActivityAction, NotificationType } from '@devtrack/types';

/** The person (or nothing, for system events) performing an action. */
export interface Actor {
  id: string;
  username: string;
}

interface Scope {
  /** Null for user-level events spanning workspaces (e.g. mark-all-read). */
  workspaceId: string | null;
  projectId: string | null;
}

export interface ActivityInput extends Scope {
  workspaceId: string;
  taskId?: string | null;
  actor: Actor | null;
  entity: { type: 'task' | 'comment' | 'project' | 'milestone'; id: string };
  action: ActivityAction;
  /** Minimal display details only — never comment/description text or secrets (§8.4). */
  metadata?: Record<string, unknown>;
  /** Optional domain event for real-time clients (§10), e.g. `task.updated`. */
  event?: { type: string; payload: Record<string, unknown> };
}

export interface NotificationInput {
  userId: string;
  workspaceId: string;
  projectId: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  resourceType: string;
  resourceId: string;
}

/**
 * Writes activity, notifications and outbox events. Every method takes the caller's
 * transaction so these rows commit (or roll back) together with the business change
 * (architecture §10, M4 rules 3 and 6). Delivery to clients is the M7 outbox publisher's job.
 */
@Injectable()
export class EventRecorder {
  async activity(tx: Executor, input: ActivityInput): Promise<void> {
    const [row] = await tx
      .insert(activityLogs)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId ?? null,
        actorId: input.actor?.id ?? null,
        entityType: input.entity.type,
        entityId: input.entity.id,
        action: input.action.slice(input.action.indexOf('.') + 1),
        metadata: input.metadata ?? {},
      })
      .returning({ id: activityLogs.id });

    await this.event(tx, 'activity.created', input, {
      activityId: row!.id,
      action: input.action,
      taskId: input.taskId ?? null,
    });
    if (input.event) await this.event(tx, input.event.type, input, input.event.payload);
  }

  /** Outbox-only event (no feed entry), e.g. `comment.updated`. */
  async event(
    tx: Executor,
    type: string,
    source: Scope & { actor: Actor | null; entity: { type: string; id: string } },
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(outboxEvents).values({
      eventType: type,
      aggregateId: source.entity.id,
      payload: {
        type,
        version: 1,
        occurredAt: new Date().toISOString(),
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        actor: source.actor ? { id: source.actor.id } : null,
        entity: source.entity,
        payload,
      },
    });
  }

  /**
   * Creates notifications, skipping the actor (nobody is notified about their own action) and
   * duplicates for the same user. Emits `notification.created` for each, addressed to the user.
   */
  async notify(tx: Executor, actor: Actor | null, inputs: NotificationInput[]): Promise<string[]> {
    const seen = new Set<string>();
    const rows = inputs.filter((n) => {
      if (n.userId === actor?.id || seen.has(n.userId)) return false;
      seen.add(n.userId);
      return true;
    });
    if (rows.length === 0) return [];

    const created = await tx
      .insert(notifications)
      .values(rows.map((n) => ({ ...n, body: n.body ?? null })))
      .returning({ id: notifications.id, userId: notifications.userId, type: notifications.type });
    for (const n of created) {
      await this.event(
        tx,
        'notification.created',
        {
          workspaceId: rows[0]!.workspaceId,
          projectId: rows[0]!.projectId,
          actor,
          entity: { type: 'user', id: n.userId },
        },
        { notificationId: n.id, type: n.type },
      );
    }
    return created.map((n) => n.userId);
  }
}

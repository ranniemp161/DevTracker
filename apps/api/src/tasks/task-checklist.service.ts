import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  projectMembers,
  sql,
  taskChecklistItems,
  users,
  type Database,
  type Executor,
} from '@devtrack/database';
import { ErrorCode, type TaskChecklistItem, type UserRef } from '@devtrack/types';
import {
  MAX_CHECKLIST_ITEMS,
  type CreateChecklistItemInput,
  type ReorderChecklistInput,
  type UpdateChecklistItemInput,
} from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import type { ProjectAccess } from '../projects/project-access.service';
import { TaskAccessService, type TaskRow } from './task-access.service';

type ItemRow = typeof taskChecklistItems.$inferSelect;

const itemNotFound = () => AppException.notFound('Checklist item not found.');

/**
 * A task's checklist (decision record 0018). Anyone who can edit the task can change it.
 * Adding, ticking, unticking and removing items show in the task's activity (without the
 * item text, like descriptions); edits and reordering only refresh open pages.
 */
@Injectable()
export class TaskChecklistService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly events: EventRecorder,
  ) {}

  async list(userId: string, taskId: string): Promise<TaskChecklistItem[]> {
    const { task } = await this.taskAccess.require(userId, taskId);
    return this.load(this.db, task.id);
  }

  async add(
    actor: Actor,
    taskId: string,
    input: CreateChecklistItemInput,
  ): Promise<TaskChecklistItem> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    if (input.assigneeId) await this.assertMember(access, input.assigneeId);
    const id = await this.db.transaction(async (tx) => {
      // Positions only order the list; a rare tie from concurrent adds sorts by creation time.
      const [stats] = await tx
        .select({
          items: count(),
          last: sql<number>`coalesce(max(${taskChecklistItems.position}), -1)::int`,
        })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, task.id));
      if ((stats?.items ?? 0) >= MAX_CHECKLIST_ITEMS) {
        throw AppException.validation([
          { path: 'body', message: `A checklist holds at most ${MAX_CHECKLIST_ITEMS} items.` },
        ]);
      }
      const [row] = await tx
        .insert(taskChecklistItems)
        .values({
          taskId: task.id,
          body: input.body,
          position: (stats?.last ?? -1) + 1,
          assigneeId: input.assigneeId ?? null,
          createdBy: actor.id,
        })
        .returning({ id: taskChecklistItems.id });
      await this.record(tx, actor, access, task, 'task.checklist_item_added', row!.id);
      return row!.id;
    });
    return (await this.load(this.db, task.id, [id]))[0]!;
  }

  async update(
    actor: Actor,
    itemId: string,
    input: UpdateChecklistItemInput,
  ): Promise<TaskChecklistItem> {
    const { item, task, access } = await this.requireItem(actor.id, itemId);
    if (input.assigneeId) await this.assertMember(access, input.assigneeId);
    const checking = input.done === true && item.doneAt === null;
    const unchecking = input.done === false && item.doneAt !== null;
    await this.db.transaction(async (tx) => {
      await tx
        .update(taskChecklistItems)
        .set({
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
          ...(checking ? { doneAt: new Date(), doneBy: actor.id } : {}),
          ...(unchecking ? { doneAt: null, doneBy: null } : {}),
        })
        .where(eq(taskChecklistItems.id, item.id));
      if (checking || unchecking) {
        await this.record(
          tx,
          actor,
          access,
          task,
          checking ? 'task.checklist_item_completed' : 'task.checklist_item_reopened',
          item.id,
        );
      } else {
        await this.refresh(tx, actor, access, task, item.id);
      }
    });
    return (await this.load(this.db, task.id, [item.id]))[0]!;
  }

  async remove(actor: Actor, itemId: string): Promise<void> {
    const { item, task, access } = await this.requireItem(actor.id, itemId);
    await this.db.transaction(async (tx) => {
      await tx.delete(taskChecklistItems).where(eq(taskChecklistItems.id, item.id));
      await this.record(tx, actor, access, task, 'task.checklist_item_removed', item.id);
    });
  }

  /** Puts the items in the given order. `itemIds` must list every item of the task once. */
  async reorder(
    actor: Actor,
    taskId: string,
    input: ReorderChecklistInput,
  ): Promise<TaskChecklistItem[]> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    await this.db.transaction(async (tx) => {
      const current = await tx
        .select({ id: taskChecklistItems.id })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, task.id))
        .for('update');
      const known = new Set(current.map((r) => r.id));
      if (
        input.itemIds.length !== known.size ||
        input.itemIds.some((id) => !known.has(id.toLowerCase()))
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'The checklist changed. Reload it and try again.',
        );
      }
      // One statement: each id gets its place in the list as the new position.
      const ordered = input.itemIds.map((id) => id.toLowerCase());
      await tx.execute(sql`
        update ${taskChecklistItems} as t
        set position = (v.ord - 1)::int, updated_at = now()
        from unnest(${sql.param(ordered)}::uuid[]) with ordinality as v(id, ord)
        where t.id = v.id and t.task_id = ${task.id}
      `);
      await this.refresh(tx, actor, access, task, task.id);
    });
    return this.load(this.db, task.id);
  }

  private async requireItem(userId: string, itemId: string) {
    const [item] = isUuid(itemId)
      ? await this.db
          .select()
          .from(taskChecklistItems)
          .where(eq(taskChecklistItems.id, itemId.toLowerCase()))
          .limit(1)
      : [];
    if (!item) throw itemNotFound();
    try {
      const { task, access } = await this.taskAccess.require(userId, item.taskId, {
        write: true,
      });
      return { item, task, access };
    } catch (err) {
      // Someone who can't see the task can't learn that the item exists.
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw itemNotFound();
      }
      throw err;
    }
  }

  private async assertMember(access: ProjectAccess, userId: string) {
    const [member] = await this.db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, access.project.id),
          eq(projectMembers.userId, userId.toLowerCase()),
        ),
      )
      .limit(1);
    if (!member) {
      throw AppException.validation([
        { path: 'assigneeId', message: 'Only project members can be assigned.' },
      ]);
    }
  }

  private async record(
    tx: Executor,
    actor: Actor,
    access: ProjectAccess,
    task: TaskRow,
    action:
      | 'task.checklist_item_added'
      | 'task.checklist_item_completed'
      | 'task.checklist_item_reopened'
      | 'task.checklist_item_removed',
    itemId: string,
  ) {
    await this.events.activity(tx, {
      ...scope(access, task),
      actor,
      action,
      // No item text: activity carries display details only, never user-written content.
      metadata: { key: `${access.project.key}-${task.taskNumber}` },
      event: { type: 'task.updated', payload: { taskId: task.id, checklistItemId: itemId } },
    });
  }

  /** Lets open boards and task pages refetch without a feed entry. */
  private async refresh(
    tx: Executor,
    actor: Actor,
    access: ProjectAccess,
    task: TaskRow,
    itemId: string,
  ) {
    await this.events.event(
      tx,
      'task.updated',
      { ...scope(access, task), actor },
      {
        taskId: task.id,
        checklistItemId: itemId,
      },
    );
  }

  /** Items with their people, in display order (optionally only `ids`). */
  private async load(
    executor: Executor,
    taskId: string,
    ids?: string[],
  ): Promise<TaskChecklistItem[]> {
    const rows = await executor
      .select()
      .from(taskChecklistItems)
      .where(
        and(
          eq(taskChecklistItems.taskId, taskId),
          ids ? inArray(taskChecklistItems.id, ids) : undefined,
        ),
      )
      .orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.createdAt));
    const people = [
      ...new Set(rows.flatMap((r) => [r.assigneeId, r.doneBy]).filter((v): v is string => !!v)),
    ];
    const refs = people.length
      ? await executor
          .select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl })
          .from(users)
          .where(inArray(users.id, people))
      : [];
    const byId = new Map<string, UserRef>(refs.map((u) => [u.id, u]));
    return rows.map((r) => toItem(r, byId));
  }
}

function toItem(r: ItemRow, people: Map<string, UserRef>): TaskChecklistItem {
  return {
    id: r.id,
    taskId: r.taskId,
    body: r.body,
    position: r.position,
    assignee: r.assigneeId ? (people.get(r.assigneeId) ?? null) : null,
    done: r.doneAt !== null,
    doneAt: r.doneAt?.toISOString() ?? null,
    doneBy: r.doneBy ? (people.get(r.doneBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

function scope(access: ProjectAccess, task: TaskRow) {
  return {
    workspaceId: access.project.workspaceId,
    projectId: access.project.id,
    taskId: task.id,
    entity: { type: 'task' as const, id: task.id },
  };
}

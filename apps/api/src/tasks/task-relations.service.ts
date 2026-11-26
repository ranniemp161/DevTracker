import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  projectMembers,
  projects,
  taskRelations,
  tasks,
  type Database,
  type Executor,
  type SQL,
} from '@devtrack/database';
import { ErrorCode, type RelatedTask, type TaskRelationKind } from '@devtrack/types';
import type { CreateTaskRelationInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUniqueViolation } from '../database/pg-errors';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import type { ProjectAccess } from '../projects/project-access.service';
import { TaskAccessService, type TaskRow } from './task-access.service';

const relationNotFound = () => AppException.notFound('Relation not found.');
const conflict = (message: string) =>
  new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);

/**
 * Task relations (decision record 0020): "blocks / blocked by" and "related to", between tasks
 * in the same workspace. Each relation shows on both tasks. Adding or removing one needs edit
 * rights on the task it's done from and view rights on the other task.
 */
@Injectable()
export class TaskRelationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly events: EventRecorder,
  ) {}

  /** The task's relations, limited to related tasks the caller can see. */
  async list(userId: string, taskId: string): Promise<RelatedTask[]> {
    const { task, access } = await this.taskAccess.require(userId, taskId);
    return this.load(userId, access, task.id);
  }

  async add(actor: Actor, taskId: string, input: CreateTaskRelationInput): Promise<RelatedTask[]> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const other = await this.requireOther(actor.id, input.taskId);
    if (other.task.id === task.id) throw conflict('A task cannot relate to itself.');
    if (other.access.project.workspaceId !== access.project.workspaceId) {
      throw conflict('Related tasks must be in the same workspace.');
    }

    // Stored form: BLOCKS is "task_id blocks related_task_id"; RELATES keeps the smaller id first.
    const [from, to] =
      input.kind === 'BLOCKED_BY'
        ? [other.task.id, task.id]
        : input.kind === 'BLOCKS'
          ? [task.id, other.task.id]
          : [task.id, other.task.id].sort();
    const type = input.kind === 'RELATES' ? 'RELATES' : 'BLOCKS';

    await this.db.transaction(async (tx) => {
      if (type === 'BLOCKS') {
        // The opposite direction already exists: the two tasks would wait on each other.
        const [reverse] = await tx
          .select({ id: taskRelations.id })
          .from(taskRelations)
          .where(
            and(
              eq(taskRelations.taskId, to!),
              eq(taskRelations.relatedTaskId, from!),
              eq(taskRelations.type, 'BLOCKS'),
            ),
          )
          .limit(1);
        if (reverse) throw conflict('These tasks would block each other.');
      }
      try {
        await tx
          .insert(taskRelations)
          .values({ taskId: from!, relatedTaskId: to!, type, createdBy: actor.id });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('These tasks are already linked that way.');
        throw err;
      }
      await this.recordBoth(tx, actor, 'task.relation_added', access, task, other, input.kind);
    });
    return this.load(actor.id, access, task.id);
  }

  async remove(actor: Actor, taskId: string, relationId: string): Promise<void> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const [relation] = await this.db
      .select()
      .from(taskRelations)
      .where(
        and(
          eq(taskRelations.id, relationId),
          or(eq(taskRelations.taskId, task.id), eq(taskRelations.relatedTaskId, task.id)),
        ),
      )
      .limit(1);
    if (!relation) throw relationNotFound();
    const otherId = relation.taskId === task.id ? relation.relatedTaskId : relation.taskId;
    const kind: TaskRelationKind =
      relation.type === 'RELATES'
        ? 'RELATES'
        : relation.taskId === task.id
          ? 'BLOCKS'
          : 'BLOCKED_BY';
    // The other task may be hidden from the caller; removing still works, but its feed entry
    // is only written when the caller could see that task.
    const other = await this.requireOther(actor.id, otherId).catch(() => null);
    await this.db.transaction(async (tx) => {
      await tx.delete(taskRelations).where(eq(taskRelations.id, relation.id));
      await this.recordBoth(tx, actor, 'task.relation_removed', access, task, other, kind);
    });
  }

  private async requireOther(userId: string, taskId: string) {
    try {
      return await this.taskAccess.require(userId, taskId);
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw AppException.validation([{ path: 'taskId', message: 'That task was not found.' }]);
      }
      throw err;
    }
  }

  /** An entry in each task's activity, worded from that task's side. */
  private async recordBoth(
    tx: Executor,
    actor: Actor,
    action: 'task.relation_added' | 'task.relation_removed',
    access: ProjectAccess,
    task: TaskRow,
    other: { task: TaskRow; access: ProjectAccess } | null,
    kind: TaskRelationKind,
  ) {
    const mirror: Record<TaskRelationKind, TaskRelationKind> = {
      BLOCKS: 'BLOCKED_BY',
      BLOCKED_BY: 'BLOCKS',
      RELATES: 'RELATES',
    };
    const sides = [
      { a: access, t: task, k: kind, o: other },
      ...(other ? [{ a: other.access, t: other.task, k: mirror[kind], o: { access, task } }] : []),
    ];
    for (const side of sides) {
      await this.events.activity(tx, {
        workspaceId: side.a.project.workspaceId,
        projectId: side.a.project.id,
        taskId: side.t.id,
        entity: { type: 'task', id: side.t.id },
        actor,
        action,
        metadata: {
          key: keyOf(side.a, side.t),
          relation: side.k.toLowerCase(),
          relatedKey: side.o ? keyOf(side.o.access, side.o.task) : null,
        },
        event: { type: 'task.updated', payload: { taskId: side.t.id, relation: true } },
      });
    }
  }

  /** Relations of `taskId` whose other task the caller can see (not deleted). */
  private async load(
    userId: string,
    access: ProjectAccess,
    taskId: string,
  ): Promise<RelatedTask[]> {
    const visible: SQL[] = [
      eq(projects.workspaceId, access.project.workspaceId),
      isNull(tasks.deletedAt),
    ];
    if (!access.isWorkspaceAdmin) {
      visible.push(
        inArray(
          projects.id,
          this.db
            .select({ id: projectMembers.projectId })
            .from(projectMembers)
            .where(eq(projectMembers.userId, userId)),
        ),
      );
    }
    const relations = await this.db
      .select()
      .from(taskRelations)
      .where(or(eq(taskRelations.taskId, taskId), eq(taskRelations.relatedTaskId, taskId)));
    if (relations.length === 0) return [];
    const otherIds = relations.map((r) => (r.taskId === taskId ? r.relatedTaskId : r.taskId));
    const others = await this.db
      .select({
        id: tasks.id,
        number: tasks.taskNumber,
        title: tasks.title,
        status: tasks.status,
        projectId: projects.id,
        projectKey: projects.key,
        projectName: projects.name,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(inArray(tasks.id, otherIds), ...visible));
    const byId = new Map(others.map((o) => [o.id, o]));
    const order: Record<TaskRelationKind, number> = { BLOCKED_BY: 0, BLOCKS: 1, RELATES: 2 };
    return relations
      .flatMap((r): RelatedTask[] => {
        const mine = r.taskId === taskId;
        const o = byId.get(mine ? r.relatedTaskId : r.taskId);
        if (!o) return [];
        const kind: TaskRelationKind =
          r.type === 'RELATES' ? 'RELATES' : mine ? 'BLOCKS' : 'BLOCKED_BY';
        return [
          {
            relationId: r.id,
            kind,
            task: {
              id: o.id,
              key: `${o.projectKey}-${o.number}`,
              title: o.title,
              status: o.status,
              projectId: o.projectId,
              projectName: o.projectName,
            },
          },
        ];
      })
      .sort((x, y) => order[x.kind] - order[y.kind] || x.task.key.localeCompare(y.task.key));
  }
}

const keyOf = (access: ProjectAccess, task: TaskRow) => `${access.project.key}-${task.taskNumber}`;

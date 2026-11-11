import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  activityLogs,
  and,
  desc,
  eq,
  inArray,
  isNull,
  labels,
  lt,
  milestones,
  ne,
  notInArray,
  projectMembers,
  projects,
  sql,
  taskAssignees,
  taskLabels,
  tasks,
  timeEntries,
  users,
  type Database,
  type Executor,
  type SQL,
} from '@devtrack/database';
import {
  ErrorCode,
  type Task,
  type TaskLabel,
  type TaskStatus,
  type TaskTimeInStatus,
  type UserRef,
} from '@devtrack/types';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { decodeCursor, encodeCursor, Paginated } from '../common/http/paginated';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService, type ProjectRow } from '../projects/project-access.service';
import { TaskAccessService, type TaskRow } from './task-access.service';
import { isTaskStatus, timeInStatus, type StatusChange } from './time-in-status';

const userRef = { id: users.id, username: users.username, avatarUrl: users.avatarUrl };

interface TaskCursor {
  n: number;
}
const isTaskCursor = (v: unknown): v is TaskCursor =>
  typeof v === 'object' && v !== null && Number.isInteger((v as TaskCursor).n);

/** completed_at follows the status (M3 rule 6). */
function completionFor(next: TaskStatus, current: TaskRow | null): Date | null | undefined {
  if (current && current.status === next) return undefined; // unchanged
  return next === 'DONE' ? new Date() : null;
}

const taskKey = (project: Pick<ProjectRow, 'key'>, task: Pick<TaskRow, 'taskNumber'>) =>
  `${project.key}-${task.taskNumber}`;

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectAccess: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly events: EventRecorder,
  ) {}

  /**
   * Creates a task with the next number for its project. The `UPDATE … RETURNING` row lock on
   * the project serializes concurrent creators; numbers are never reused (§7.3, M3 rule 4).
   */
  async create(actor: Actor, projectId: string, input: CreateTaskInput): Promise<Task> {
    const { project } = await this.projectAccess.require(actor.id, projectId, { write: true });
    const assigneeIds = input.assigneeIds ?? [];
    await this.assertProjectMembers(projectId, assigneeIds);
    const milestoneId = input.milestoneId
      ? (await this.requireMilestoneIn(projectId, input.milestoneId)).id
      : null;
    const status = input.status ?? 'TODO';

    const taskId = await this.db.transaction(async (tx) => {
      const [allocated] = await tx
        .update(projects)
        .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
        .where(and(eq(projects.id, projectId), ne(projects.status, 'ARCHIVED')))
        .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });
      if (!allocated) throw projectArchived(); // archived between the access check and now

      const [task] = await tx
        .insert(tasks)
        .values({
          projectId,
          taskNumber: allocated.number,
          title: input.title,
          description: input.description ?? null,
          status,
          priority: input.priority ?? 'MEDIUM',
          reporterId: actor.id,
          dueDate: input.dueDate ?? null,
          milestoneId,
          estimateMinutes: input.estimateMinutes ?? null,
          completedAt: status === 'DONE' ? new Date() : null,
        })
        .returning();
      if (assigneeIds.length > 0) {
        await tx
          .insert(taskAssignees)
          .values(assigneeIds.map((id) => ({ taskId: task!.id, userId: id })));
      }

      await this.events.activity(tx, {
        ...scope(project, task!),
        actor,
        action: 'task.created',
        metadata: { key: taskKey(project, task!), title: task!.title, status },
        event: { type: 'task.created', payload: { taskId: task!.id, status } },
      });
      await this.notifyAssigned(tx, actor, project, task!, assigneeIds);
      return task!.id;
    });
    return (await this.load([taskId], project.key))[0]!;
  }

  /** Newest first, cursor-paginated, with optional filters (M3 rule 9). */
  async list(userId: string, projectId: string, query: ListTasksQuery): Promise<Paginated<Task>> {
    const { project } = await this.projectAccess.require(userId, projectId);
    const conditions: SQL[] = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
    if (query.status) conditions.push(eq(tasks.status, query.status));
    if (query.priority) conditions.push(eq(tasks.priority, query.priority));
    if (query.assigneeId) {
      if (query.assigneeId === 'unassigned') {
        conditions.push(
          notInArray(tasks.id, this.db.select({ id: taskAssignees.taskId }).from(taskAssignees)),
        );
      } else {
        conditions.push(
          inArray(
            tasks.id,
            this.db
              .select({ id: taskAssignees.taskId })
              .from(taskAssignees)
              .where(eq(taskAssignees.userId, query.assigneeId.toLowerCase())),
          ),
        );
      }
    }
    if (query.labelId) {
      conditions.push(
        inArray(
          tasks.id,
          this.db
            .select({ id: taskLabels.taskId })
            .from(taskLabels)
            .where(eq(taskLabels.labelId, query.labelId.toLowerCase())),
        ),
      );
    }
    if (query.milestoneId) {
      conditions.push(
        query.milestoneId === 'none'
          ? isNull(tasks.milestoneId)
          : eq(tasks.milestoneId, query.milestoneId.toLowerCase()),
      );
    }
    if (query.cursor) {
      conditions.push(lt(tasks.taskNumber, decodeCursor(query.cursor, isTaskCursor).n));
    }

    const rows = await this.db
      .select({ id: tasks.id, number: tasks.taskNumber })
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.taskNumber))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? encodeCursor({ n: page.at(-1)!.number }) : null;
    return new Paginated(
      await this.load(
        page.map((r) => r.id),
        project.key,
      ),
      nextCursor,
    );
  }

  async get(userId: string, taskId: string): Promise<Task> {
    const { task, access } = await this.taskAccess.require(userId, taskId);
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /**
   * Time spent in each status, read from the task's own activity history. Every status change
   * is logged in the transaction that makes it, so the history is complete (record 0011).
   */
  async timeInStatus(userId: string, taskId: string): Promise<TaskTimeInStatus> {
    const { task } = await this.taskAccess.require(userId, taskId);
    const rows = await this.db
      .select({
        action: activityLogs.action,
        metadata: activityLogs.metadata,
        at: activityLogs.createdAt,
      })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.taskId, task.id),
          eq(activityLogs.entityType, 'task'),
          inArray(activityLogs.action, ['created', 'updated']),
        ),
      )
      .orderBy(activityLogs.createdAt, activityLogs.id);

    const changes: StatusChange[] = [];
    let initial: unknown = rows.find((r) => r.action === 'created')?.metadata.status;
    for (const row of rows) {
      if (row.action !== 'updated') continue;
      const change = (row.metadata.changes as { status?: { from?: unknown; to?: unknown } })
        ?.status;
      if (!isTaskStatus(change?.to)) continue;
      if (changes.length === 0 && !isTaskStatus(initial)) initial = change.from;
      changes.push({ at: row.at, to: change.to });
    }

    return {
      taskId: task.id,
      ...timeInStatus({
        createdAt: task.createdAt,
        initialStatus: isTaskStatus(initial) ? initial : task.status,
        changes,
        completedAt: task.completedAt,
        now: new Date(),
      }),
    };
  }

  async update(actor: Actor, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const changes = describeChanges(task, input);
    const nextMilestone =
      input.milestoneId === undefined || input.milestoneId === null
        ? null
        : await this.requireMilestoneIn(task.projectId, input.milestoneId);
    if (input.milestoneId !== undefined && (nextMilestone?.id ?? null) !== task.milestoneId) {
      // Activity shows names, not ids, so the feed stays readable after renames or deletion.
      const previous = task.milestoneId
        ? await this.db
            .select({ name: milestones.name })
            .from(milestones)
            .where(eq(milestones.id, task.milestoneId))
            .then((r) => r[0]?.name ?? null)
        : null;
      changes.milestone = { from: previous, to: nextMilestone?.name ?? null };
    }

    if (Object.keys(changes).length > 0) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(tasks)
          .set({
            title: input.title,
            description: input.description,
            priority: input.priority,
            dueDate: input.dueDate,
            milestoneId: input.milestoneId === undefined ? undefined : (nextMilestone?.id ?? null),
            estimateMinutes: input.estimateMinutes,
            status: input.status,
            completedAt: input.status ? completionFor(input.status, task) : undefined,
          })
          .where(eq(tasks.id, task.id));
        await this.events.activity(tx, {
          ...scope(access.project, task),
          actor,
          action: 'task.updated',
          metadata: { key: taskKey(access.project, task), changes },
          event: { type: 'task.updated', payload: { taskId: task.id, changes } },
        });
      });
    }
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /** Soft delete: the reporter or a workspace Owner/Admin (M3 rule 5). */
  async remove(actor: Actor, taskId: string): Promise<void> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    if (task.reporterId !== actor.id && !access.canManage) {
      throw AppException.forbidden('Only the reporter or a workspace admin can delete this task.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, task.id));
      await this.events.activity(tx, {
        ...scope(access.project, task),
        actor,
        action: 'task.deleted',
        metadata: { key: taskKey(access.project, task), title: task.title },
        event: { type: 'task.deleted', payload: { taskId: task.id } },
      });
    });
  }

  async addAssignees(actor: Actor, taskId: string, assigneeIds: string[]): Promise<Task> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    await this.assertProjectMembers(task.projectId, assigneeIds);
    await this.db.transaction(async (tx) => {
      // RETURNING yields only rows actually inserted, i.e. new assignees.
      const added = await tx
        .insert(taskAssignees)
        .values(assigneeIds.map((id) => ({ taskId: task.id, userId: id })))
        .onConflictDoNothing()
        .returning({ userId: taskAssignees.userId });
      const newIds = added.map((a) => a.userId);
      if (newIds.length === 0) return;
      const people = await this.usernames(tx, newIds);
      for (const person of people) {
        await this.events.activity(tx, {
          ...scope(access.project, task),
          actor,
          action: 'task.assigned',
          metadata: { key: taskKey(access.project, task), user: person },
          event: {
            type: 'task.assigned',
            payload: { taskId: task.id, userId: person.id, assigned: true },
          },
        });
      }
      await this.notifyAssigned(tx, actor, access.project, task, newIds);
    });
    return (await this.load([task.id], access.project.key))[0]!;
  }

  async removeAssignee(actor: Actor, taskId: string, assigneeId: string): Promise<Task> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(taskAssignees)
        .where(and(eq(taskAssignees.taskId, task.id), eq(taskAssignees.userId, assigneeId)))
        .returning({ userId: taskAssignees.userId });
      if (removed.length === 0)
        throw AppException.notFound('This person is not assigned to the task.');
      const [person] = await this.usernames(tx, [assigneeId]);
      await this.events.activity(tx, {
        ...scope(access.project, task),
        actor,
        action: 'task.unassigned',
        metadata: { key: taskKey(access.project, task), user: person ?? null },
        event: {
          type: 'task.assigned',
          payload: { taskId: task.id, userId: assigneeId, assigned: false },
        },
      });
    });
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /**
   * Attaches a workspace label. Labels from another workspace are reported as not found,
   * so they can never be linked across workspaces (architecture §8.4).
   */
  async addLabel(actor: Actor, taskId: string, labelId: string): Promise<Task> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const [label] = await this.db
      .select({ id: labels.id, name: labels.name })
      .from(labels)
      .where(
        and(
          eq(labels.id, labelId.toLowerCase()),
          eq(labels.workspaceId, access.project.workspaceId),
        ),
      )
      .limit(1);
    if (!label) throw AppException.notFound('Label not found.');
    await this.db.transaction(async (tx) => {
      const added = await tx
        .insert(taskLabels)
        .values({ taskId: task.id, labelId: label.id })
        .onConflictDoNothing()
        .returning({ labelId: taskLabels.labelId });
      if (added.length === 0) return;
      await this.events.activity(tx, {
        ...scope(access.project, task),
        actor,
        action: 'task.labeled',
        metadata: { key: taskKey(access.project, task), label },
        event: { type: 'task.updated', payload: { taskId: task.id, labelAdded: label.id } },
      });
    });
    return (await this.load([task.id], access.project.key))[0]!;
  }

  async removeLabel(actor: Actor, taskId: string, labelId: string): Promise<Task> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(taskLabels)
        .where(and(eq(taskLabels.taskId, task.id), eq(taskLabels.labelId, labelId)))
        .returning({ labelId: taskLabels.labelId });
      if (removed.length === 0) throw AppException.notFound('This label is not on the task.');
      const [label] = await tx
        .select({ id: labels.id, name: labels.name })
        .from(labels)
        .where(eq(labels.id, labelId));
      await this.events.activity(tx, {
        ...scope(access.project, task),
        actor,
        action: 'task.unlabeled',
        metadata: { key: taskKey(access.project, task), label: label ?? null },
        event: { type: 'task.updated', payload: { taskId: task.id, labelRemoved: labelId } },
      });
    });
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /** TASK_ASSIGNED for each new assignee except the actor (M4 rule 5). */
  private async notifyAssigned(
    tx: Executor,
    actor: Actor,
    project: ProjectRow,
    task: TaskRow,
    userIds: string[],
  ): Promise<void> {
    await this.events.notify(
      tx,
      actor,
      userIds.map((userId) => ({
        userId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        type: 'TASK_ASSIGNED' as const,
        title: `@${actor.username} assigned you to ${taskKey(project, task)}`,
        body: task.title,
        resourceType: 'task',
        resourceId: task.id,
      })),
    );
  }

  private usernames(tx: Executor, ids: string[]) {
    return tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, ids));
  }

  /** Assignees must be members of the project (M3 rule 7). */
  private async assertProjectMembers(projectId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const rows = await this.db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds)));
    if (rows.length !== userIds.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.NOT_PROJECT_MEMBER,
        'Tasks can only be assigned to members of the project.',
      );
    }
  }

  /** A milestone may only hold tasks from its own project. */
  private async requireMilestoneIn(projectId: string, milestoneId: string) {
    const [milestone] = await this.db
      .select({ id: milestones.id, name: milestones.name })
      .from(milestones)
      .where(and(eq(milestones.id, milestoneId.toLowerCase()), eq(milestones.projectId, projectId)))
      .limit(1);
    if (!milestone) {
      throw AppException.validation([
        { path: 'milestoneId', message: 'Choose a milestone from this project.' },
      ]);
    }
    return milestone;
  }

  /** Loads tasks with reporter, assignees and labels, preserving the order of `ids`. */
  private async load(ids: string[], projectKey: string): Promise<Task[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ task: tasks, reporter: userRef })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.reporterId))
      .where(inArray(tasks.id, ids));
    const assignees = await this.db
      .select({ taskId: taskAssignees.taskId, user: userRef })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, ids))
      .orderBy(taskAssignees.assignedAt);
    const attached = await this.db
      .select({
        taskId: taskLabels.taskId,
        label: { id: labels.id, name: labels.name, color: labels.color },
      })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(inArray(taskLabels.taskId, ids))
      .orderBy(labels.name);
    const logged = await this.db
      .select({
        taskId: timeEntries.taskId,
        minutes: sql<number>`sum(${timeEntries.minutes})::int`,
      })
      .from(timeEntries)
      .where(inArray(timeEntries.taskId, ids))
      .groupBy(timeEntries.taskId);
    const loggedByTask = new Map(logged.map((l) => [l.taskId, l.minutes]));

    const assigneesByTask = new Map<string, UserRef[]>();
    for (const a of assignees) {
      assigneesByTask.set(a.taskId, [...(assigneesByTask.get(a.taskId) ?? []), a.user]);
    }
    const labelsByTask = new Map<string, TaskLabel[]>();
    for (const l of attached) {
      labelsByTask.set(l.taskId, [...(labelsByTask.get(l.taskId) ?? []), l.label]);
    }
    const byId = new Map(rows.map((r) => [r.task.id, r]));
    return ids.map((id) => {
      const { task, reporter } = byId.get(id)!;
      return {
        id: task.id,
        projectId: task.projectId,
        number: task.taskNumber,
        key: `${projectKey}-${task.taskNumber}`,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        reporter,
        assignees: assigneesByTask.get(task.id) ?? [],
        labels: labelsByTask.get(task.id) ?? [],
        dueDate: task.dueDate,
        milestoneId: task.milestoneId,
        estimateMinutes: task.estimateMinutes,
        loggedMinutes: loggedByTask.get(task.id) ?? 0,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
      };
    });
  }
}

function scope(project: ProjectRow, task: TaskRow) {
  return {
    workspaceId: project.workspaceId,
    projectId: project.id,
    taskId: task.id,
    entity: { type: 'task' as const, id: task.id },
  };
}

/**
 * Field changes for the activity feed. The description is reported as changed without its
 * text (M4 rule 3: no description/comment text in activity metadata).
 */
function describeChanges(task: TaskRow, input: UpdateTaskInput): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const field of ['title', 'status', 'priority', 'dueDate', 'estimateMinutes'] as const) {
    if (input[field] !== undefined && input[field] !== task[field]) {
      changes[field] = { from: task[field], to: input[field] };
    }
  }
  if (input.description !== undefined && input.description !== task.description) {
    changes.description = { changed: true };
  }
  return changes;
}

const projectArchived = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.PROJECT_ARCHIVED,
    'This project is archived and read-only.',
  );

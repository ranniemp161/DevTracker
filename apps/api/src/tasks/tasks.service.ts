import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  labels,
  lt,
  ne,
  projectMembers,
  projects,
  sql,
  taskAssignees,
  taskLabels,
  tasks,
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
  type UserRef,
} from '@devtrack/types';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { decodeCursor, encodeCursor, Paginated } from '../common/http/paginated';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import {
  ProjectAccessService,
  type ProjectAccess,
  type ProjectAccessOptions,
} from '../projects/project-access.service';

type TaskRow = typeof tasks.$inferSelect;
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

@Injectable()
export class TasksService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * Creates a task with the next number for its project. The `UPDATE … RETURNING` row lock on
   * the project serializes concurrent creators; numbers are never reused (§7.3, M3 rule 4).
   */
  async create(userId: string, projectId: string, input: CreateTaskInput): Promise<Task> {
    const { project } = await this.access.require(userId, projectId, { write: true });
    const assigneeIds = input.assigneeIds ?? [];
    await this.assertProjectMembers(projectId, assigneeIds);
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
          reporterId: userId,
          dueDate: input.dueDate ?? null,
          completedAt: status === 'DONE' ? new Date() : null,
        })
        .returning({ id: tasks.id });
      if (assigneeIds.length > 0) {
        await tx
          .insert(taskAssignees)
          .values(assigneeIds.map((id) => ({ taskId: task!.id, userId: id })));
      }
      return task!.id;
    });
    return (await this.load([taskId], project.key))[0]!;
  }

  /** Newest first, cursor-paginated, with optional status/priority/assignee filters (M3 rule 9). */
  async list(userId: string, projectId: string, query: ListTasksQuery): Promise<Paginated<Task>> {
    const { project } = await this.access.require(userId, projectId);
    const conditions: SQL[] = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
    if (query.status) conditions.push(eq(tasks.status, query.status));
    if (query.priority) conditions.push(eq(tasks.priority, query.priority));
    if (query.assigneeId) {
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
    if (query.cursor)
      conditions.push(lt(tasks.taskNumber, decodeCursor(query.cursor, isTaskCursor).n));

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
    const { task, access } = await this.requireTask(userId, taskId);
    return (await this.load([task.id], access.project.key))[0]!;
  }

  async update(userId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    const { task, access } = await this.requireTask(userId, taskId, { write: true });
    await this.db
      .update(tasks)
      .set({
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate,
        status: input.status,
        completedAt: input.status ? completionFor(input.status, task) : undefined,
      })
      .where(eq(tasks.id, task.id));
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /** Soft delete: the reporter or a workspace Owner/Admin (M3 rule 5). */
  async remove(userId: string, taskId: string): Promise<void> {
    const { task, access } = await this.requireTask(userId, taskId, { write: true });
    if (task.reporterId !== userId && !access.canManage) {
      throw AppException.forbidden('Only the reporter or a workspace admin can delete this task.');
    }
    await this.db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, task.id));
  }

  async addAssignees(userId: string, taskId: string, assigneeIds: string[]): Promise<Task> {
    const { task, access } = await this.requireTask(userId, taskId, { write: true });
    await this.assertProjectMembers(task.projectId, assigneeIds);
    await this.db
      .insert(taskAssignees)
      .values(assigneeIds.map((id) => ({ taskId: task.id, userId: id })))
      .onConflictDoNothing();
    return (await this.load([task.id], access.project.key))[0]!;
  }

  async removeAssignee(userId: string, taskId: string, assigneeId: string): Promise<Task> {
    const { task, access } = await this.requireTask(userId, taskId, { write: true });
    const removed = await this.db
      .delete(taskAssignees)
      .where(and(eq(taskAssignees.taskId, task.id), eq(taskAssignees.userId, assigneeId)))
      .returning({ userId: taskAssignees.userId });
    if (removed.length === 0)
      throw AppException.notFound('This person is not assigned to the task.');
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /**
   * Attaches a workspace label. Labels from another workspace are reported as not found,
   * so they can never be linked across workspaces (architecture §8.4).
   */
  async addLabel(userId: string, taskId: string, labelId: string): Promise<Task> {
    const { task, access } = await this.requireTask(userId, taskId, { write: true });
    const [label] = await this.db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.id, labelId.toLowerCase()), eq(labels.workspaceId, access.project.workspaceId)))
      .limit(1);
    if (!label) throw AppException.notFound('Label not found.');
    await this.db.insert(taskLabels).values({ taskId: task.id, labelId: label.id }).onConflictDoNothing();
    return (await this.load([task.id], access.project.key))[0]!;
  }

  async removeLabel(userId: string, taskId: string, labelId: string): Promise<Task> {
    const { task, access } = await this.requireTask(userId, taskId, { write: true });
    const removed = await this.db
      .delete(taskLabels)
      .where(and(eq(taskLabels.taskId, task.id), eq(taskLabels.labelId, labelId)))
      .returning({ labelId: taskLabels.labelId });
    if (removed.length === 0) throw AppException.notFound('This label is not on the task.');
    return (await this.load([task.id], access.project.key))[0]!;
  }

  /** Loads a live task and authorizes through its project; hidden tasks are 404. */
  private async requireTask(
    userId: string,
    taskId: string,
    options: ProjectAccessOptions = {},
  ): Promise<{ task: TaskRow; access: ProjectAccess }> {
    if (!isUuid(taskId)) throw taskNotFound();
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) throw taskNotFound();
    try {
      return { task, access: await this.access.require(userId, task.projectId, options) };
    } catch (err) {
      // Outsiders must not learn that the task exists.
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND)
        throw taskNotFound();
      throw err;
    }
  }

  /** Assignees must be members of the project (M3 rule 7). */
  private async assertProjectMembers(
    projectId: string,
    userIds: string[],
    executor: Executor = this.db,
  ) {
    if (userIds.length === 0) return;
    const rows = await executor
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

  /** Loads tasks with reporter and assignees, preserving the order of `ids`. */
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
      .select({ taskId: taskLabels.taskId, label: { id: labels.id, name: labels.name, color: labels.color } })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(inArray(taskLabels.taskId, ids))
      .orderBy(labels.name);

    const byTask = new Map<string, UserRef[]>();
    for (const a of assignees) byTask.set(a.taskId, [...(byTask.get(a.taskId) ?? []), a.user]);
    const labelsByTask = new Map<string, TaskLabel[]>();
    for (const l of attached) labelsByTask.set(l.taskId, [...(labelsByTask.get(l.taskId) ?? []), l.label]);
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
        assignees: byTask.get(task.id) ?? [],
        labels: labelsByTask.get(task.id) ?? [],
        dueDate: task.dueDate,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
      };
    });
  }
}

const taskNotFound = () => AppException.notFound('Task not found.');
const projectArchived = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.PROJECT_ARCHIVED,
    'This project is archived and read-only.',
  );

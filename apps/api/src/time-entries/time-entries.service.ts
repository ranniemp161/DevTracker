import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  activeTaskTimers,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  tasks,
  timeEntries,
  users,
  type Database,
} from '@devtrack/database';
import {
  ErrorCode,
  type ActiveTaskTimer,
  type ProjectTimesheetRow,
  type TimeEntry,
} from '@devtrack/types';
import {
  MAX_ENTRY_MINUTES,
  type CreateTimeEntryInput,
  type ProjectTimesheetQuery,
  type StartTaskTimerInput,
  type UpdateTimeEntryInput,
} from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService, type ProjectAccess } from '../projects/project-access.service';
import { TaskAccessService, type TaskRow } from '../tasks/task-access.service';

const userRef = { id: users.id, username: users.username, avatarUrl: users.avatarUrl };

const entryNotFound = () => AppException.notFound('Time entry not found.');
const timerChanged = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'Your active timer changed. Try again.',
  );

type TimerRow = typeof activeTaskTimers.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Time logged against tasks (decision record 0012). Anyone who can edit the task can add,
 * change or remove any entry on it; every change is recorded in the task's activity.
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly events: EventRecorder,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async timesheet(
    userId: string,
    projectId: string,
    { from, to }: ProjectTimesheetQuery,
  ): Promise<ProjectTimesheetRow[]> {
    await this.projectAccess.require(userId, projectId);
    return this.db
      .select({
        taskId: tasks.id,
        taskNumber: tasks.taskNumber,
        taskTitle: tasks.title,
        user: userRef,
        minutes: sql<number>`sum(${timeEntries.minutes})`.mapWith(Number),
      })
      .from(tasks)
      .innerJoin(timeEntries, eq(timeEntries.taskId, tasks.id))
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          gte(timeEntries.spentOn, from),
          lte(timeEntries.spentOn, to),
        ),
      )
      .groupBy(tasks.id, users.id)
      .orderBy(tasks.taskNumber, users.username);
  }

  /** Most recent work day first. */
  async list(userId: string, taskId: string): Promise<TimeEntry[]> {
    const { task } = await this.taskAccess.require(userId, taskId);
    const rows = await this.db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(eq(timeEntries.taskId, task.id))
      .orderBy(desc(timeEntries.spentOn), desc(timeEntries.createdAt));
    return this.load(rows.map((r) => r.id));
  }

  async create(actor: Actor, taskId: string, input: CreateTimeEntryInput): Promise<TimeEntry> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const id = await this.db.transaction((tx) => this.record(tx, actor, task, access, input));
    return (await this.load([id]))[0]!;
  }

  async activeTimer(userId: string): Promise<ActiveTaskTimer | null> {
    const timer = await this.findTimer(userId);
    if (!timer) return null;
    try {
      const { task, access } = await this.taskAccess.require(userId, timer.taskId);
      return timerResponse(timer, task, access.project.status !== 'ARCHIVED');
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        return timerResponse(timer);
      }
      throw err;
    }
  }

  async startTimer(actor: Actor, taskId: string, input: StartTaskTimerInput) {
    const { task } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const previous = await this.findTimer(actor.id);
    if (previous?.taskId === taskId) return timerResponse(previous, task);
    if ((previous?.id ?? undefined) !== input.replaceTimerId) throw timerChanged();
    const previousTask = previous
      ? await this.taskAccess.require(actor.id, previous.taskId, { write: true })
      : null;
    return this.db.transaction(async (tx) => {
      const now = new Date();
      if (previous && previousTask) {
        const ended = await this.takeTimer(tx, actor.id, previous.id);
        if (!ended) throw timerChanged();
        await this.recordTimer(tx, actor, ended, previousTask, now);
      }
      const [timer] = await tx
        .insert(activeTaskTimers)
        .values({ userId: actor.id, taskId, spentOn: input.spentOn, startedAt: now })
        .onConflictDoNothing()
        .returning();
      if (!timer) throw timerChanged();
      return timerResponse(timer, task);
    });
  }

  async stopTimer(actor: Actor, id: string): Promise<void> {
    const timer = await this.findTimer(actor.id);
    if (timer?.id === id) {
      const task = await this.taskAccess.require(actor.id, timer.taskId, { write: true });
      await this.db.transaction(async (tx) => {
        const ended = await this.takeTimer(tx, actor.id, id);
        if (ended) await this.recordTimer(tx, actor, ended, task, new Date());
      });
    }
    const [logged] = await this.db
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, actor.id)));
    if (!logged) throw timerChanged();
  }

  async discardTimer(userId: string, id: string): Promise<void> {
    await this.takeTimer(this.db, userId, id);
  }

  private async findTimer(userId: string) {
    const [timer] = await this.db
      .select()
      .from(activeTaskTimers)
      .where(eq(activeTaskTimers.userId, userId));
    return timer;
  }

  private async takeTimer(db: Database | Transaction, userId: string, id: string) {
    const [timer] = await db
      .delete(activeTaskTimers)
      .where(and(eq(activeTaskTimers.userId, userId), eq(activeTaskTimers.id, id)))
      .returning();
    return timer;
  }

  private async recordTimer(
    tx: Transaction,
    actor: Actor,
    timer: TimerRow,
    { task, access }: { task: TaskRow; access: ProjectAccess },
    stoppedAt: Date,
  ) {
    const elapsed = Math.round((stoppedAt.getTime() - timer.startedAt.getTime()) / 60_000);
    await this.record(
      tx,
      actor,
      task,
      access,
      {
        minutes: Math.max(1, Math.min(MAX_ENTRY_MINUTES, elapsed)),
        spentOn: timer.spentOn,
      },
      timer.id,
    );
  }

  private async record(
    tx: Transaction,
    actor: Actor,
    task: TaskRow,
    access: ProjectAccess,
    input: CreateTimeEntryInput,
    id?: string,
  ) {
    const [entry] = await tx
      .insert(timeEntries)
      .values({
        id,
        taskId: task.id,
        userId: actor.id,
        minutes: input.minutes,
        spentOn: input.spentOn,
        note: input.note ?? null,
      })
      .returning({ id: timeEntries.id });
    await this.events.activity(tx, {
      ...scope(access, task),
      actor,
      action: 'task.time_logged',
      metadata: { key: taskKey(access, task), minutes: input.minutes },
      event: { type: 'task.updated', payload: { taskId: task.id, timeEntryId: entry!.id } },
    });
    return entry!.id;
  }

  async update(actor: Actor, entryId: string, input: UpdateTimeEntryInput): Promise<TimeEntry> {
    const { entry, task, access } = await this.requireEntry(actor.id, entryId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(timeEntries)
        .set({ minutes: input.minutes, spentOn: input.spentOn, note: input.note })
        .where(eq(timeEntries.id, entry.id));
      await this.events.activity(tx, {
        ...scope(access, task),
        actor,
        action: 'task.time_updated',
        // The note is free text, so it stays out of activity (M4 rule 3).
        metadata: {
          key: taskKey(access, task),
          minutes: { from: entry.minutes, to: input.minutes ?? entry.minutes },
        },
        event: { type: 'task.updated', payload: { taskId: task.id, timeEntryId: entry.id } },
      });
    });
    return (await this.load([entry.id]))[0]!;
  }

  async remove(actor: Actor, entryId: string): Promise<void> {
    const { entry, task, access } = await this.requireEntry(actor.id, entryId);
    await this.db.transaction(async (tx) => {
      await tx.delete(timeEntries).where(eq(timeEntries.id, entry.id));
      await this.events.activity(tx, {
        ...scope(access, task),
        actor,
        action: 'task.time_removed',
        metadata: { key: taskKey(access, task), minutes: entry.minutes },
        event: { type: 'task.updated', payload: { taskId: task.id, timeEntryId: entry.id } },
      });
    });
  }

  /** Resolves an entry through its task, so outsiders get the same 404 as for a missing one. */
  private async requireEntry(userId: string, entryId: string) {
    const [entry] = isUuid(entryId)
      ? await this.db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1)
      : [];
    if (!entry) throw entryNotFound();
    try {
      const { task, access } = await this.taskAccess.require(userId, entry.taskId, {
        write: true,
      });
      return { entry, task, access };
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw entryNotFound();
      }
      throw err;
    }
  }

  /** Loads entries with the person who logged them, preserving the order of `ids`. */
  private async load(ids: string[]): Promise<TimeEntry[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ entry: timeEntries, user: userRef })
      .from(timeEntries)
      .leftJoin(users, eq(users.id, timeEntries.userId))
      .where(inArray(timeEntries.id, ids));
    const byId = new Map(rows.map((r) => [r.entry.id, r]));
    return ids.map((id) => {
      const { entry, user } = byId.get(id)!;
      return {
        id: entry.id,
        taskId: entry.taskId,
        user,
        minutes: entry.minutes,
        spentOn: entry.spentOn,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString(),
      };
    });
  }
}

const taskKey = (access: ProjectAccess, task: TaskRow) =>
  `${access.project.key}-${task.taskNumber}`;

function timerResponse(timer: TimerRow, task?: TaskRow, canStop = Boolean(task)): ActiveTaskTimer {
  return {
    id: timer.id,
    taskId: timer.taskId,
    projectId: task?.projectId ?? null,
    taskTitle: task?.title ?? null,
    startedAt: timer.startedAt.toISOString(),
    canStop,
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

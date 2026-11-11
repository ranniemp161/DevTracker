import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray, timeEntries, users, type Database } from '@devtrack/database';
import type { TimeEntry } from '@devtrack/types';
import type { CreateTimeEntryInput, UpdateTimeEntryInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import type { ProjectAccess } from '../projects/project-access.service';
import { TaskAccessService, type TaskRow } from '../tasks/task-access.service';

const userRef = { id: users.id, username: users.username, avatarUrl: users.avatarUrl };

const entryNotFound = () => AppException.notFound('Time entry not found.');

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
  ) {}

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
    const id = await this.db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(timeEntries)
        .values({
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
    });
    return (await this.load([id]))[0]!;
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

function scope(access: ProjectAccess, task: TaskRow) {
  return {
    workspaceId: access.project.workspaceId,
    projectId: access.project.id,
    taskId: task.id,
    entity: { type: 'task' as const, id: task.id },
  };
}

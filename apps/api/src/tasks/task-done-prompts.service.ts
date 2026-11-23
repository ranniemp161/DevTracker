import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  githubPullRequests,
  githubRepositories,
  inArray,
  isNull,
  notifications,
  taskDonePrompts,
  type Database,
  type Executor,
} from '@devtrack/database';
import { ErrorCode, type TaskDonePrompt } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { TaskAccessService } from './task-access.service';

export type PromptResolution = 'done' | 'dismissed' | 'status_done';

/**
 * "Mark done?" prompts (decision record 0021 §4). Webhook processing creates them when a linked
 * pull request merges; this service lists, dismisses and closes them. Moving a task to Done in
 * any way closes every open prompt on it.
 */
@Injectable()
export class TaskDonePrompts {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly events: EventRecorder,
  ) {}

  /** Open prompts on a task, oldest first. */
  async listOpen(userId: string, taskId: string): Promise<TaskDonePrompt[]> {
    const { task } = await this.taskAccess.require(userId, taskId);
    const rows = await this.db
      .select({
        id: taskDonePrompts.id,
        createdAt: taskDonePrompts.createdAt,
        number: githubPullRequests.number,
        title: githubPullRequests.title,
        url: githubPullRequests.url,
        repository: githubRepositories.fullName,
      })
      .from(taskDonePrompts)
      .innerJoin(githubPullRequests, eq(githubPullRequests.id, taskDonePrompts.pullRequestId))
      .innerJoin(githubRepositories, eq(githubRepositories.id, githubPullRequests.repositoryId))
      .where(and(eq(taskDonePrompts.taskId, task.id), isNull(taskDonePrompts.resolvedAt)))
      .orderBy(taskDonePrompts.createdAt, taskDonePrompts.id);
    return rows.map((r) => ({
      id: r.id,
      pullRequest: { number: r.number, title: r.title, url: r.url, repository: r.repository },
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Throws 409 unless the task has an open prompt. Used before "Mark done". */
  async requireOpen(userId: string, taskId: string): Promise<void> {
    if ((await this.listOpen(userId, taskId)).length === 0) throw alreadyHandled();
  }

  /** Dismisses one prompt for everyone. */
  async dismiss(actor: Actor, taskId: string, promptId: string): Promise<void> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    if (!isUuid(promptId)) throw promptNotFound();
    await this.db.transaction(async (tx) => {
      const closed = await this.close(
        tx,
        { id: task.id, projectId: task.projectId, workspaceId: access.project.workspaceId },
        actor,
        'dismissed',
        promptId,
      );
      if (closed === 0) {
        const [exists] = await tx
          .select({ id: taskDonePrompts.id })
          .from(taskDonePrompts)
          .where(and(eq(taskDonePrompts.id, promptId), eq(taskDonePrompts.taskId, task.id)));
        throw exists ? alreadyHandled() : promptNotFound();
      }
    });
  }

  /**
   * Closes the task's open prompts (or just `promptId`), marks their notifications read so the
   * bell drops the button, and tells open pages. Returns how many closed.
   */
  async close(
    tx: Executor,
    task: { id: string; projectId: string; workspaceId: string },
    actor: Actor | null,
    resolution: PromptResolution,
    promptId?: string,
  ): Promise<number> {
    const closed = await tx
      .update(taskDonePrompts)
      .set({ resolvedAt: new Date(), resolvedBy: actor?.id ?? null, resolution })
      .where(
        and(
          eq(taskDonePrompts.taskId, task.id),
          isNull(taskDonePrompts.resolvedAt),
          promptId ? eq(taskDonePrompts.id, promptId) : undefined,
        ),
      )
      .returning({ id: taskDonePrompts.id });
    if (closed.length === 0) return 0;

    const stillOpen = await tx
      .select({ id: taskDonePrompts.id })
      .from(taskDonePrompts)
      .where(and(eq(taskDonePrompts.taskId, task.id), isNull(taskDonePrompts.resolvedAt)))
      .limit(1);
    if (stillOpen.length === 0) {
      const read = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.type, 'TASK_DONE_PROMPT'),
            eq(notifications.resourceId, task.id),
            isNull(notifications.readAt),
          ),
        )
        .returning({ id: notifications.id, userId: notifications.userId });
      for (const userId of new Set(read.map((n) => n.userId))) {
        await this.events.event(
          tx,
          'notification.read',
          {
            workspaceId: task.workspaceId,
            projectId: task.projectId,
            actor,
            entity: { type: 'user', id: userId },
          },
          { notificationIds: read.filter((n) => n.userId === userId).map((n) => n.id) },
        );
      }
    }

    await this.events.event(
      tx,
      'task.updated',
      {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        actor,
        entity: { type: 'task', id: task.id },
      },
      { taskId: task.id, donePrompt: true },
    );
    return closed.length;
  }

  /** Closes open prompts on tasks that just moved to Done another way. */
  async closeForDone(
    tx: Executor,
    tasks: { id: string; projectId: string; workspaceId: string }[],
    actor: Actor | null,
    resolution: PromptResolution = 'status_done',
  ): Promise<void> {
    if (tasks.length === 0) return;
    const open = await tx
      .select({ taskId: taskDonePrompts.taskId })
      .from(taskDonePrompts)
      .where(
        and(
          inArray(
            taskDonePrompts.taskId,
            tasks.map((t) => t.id),
          ),
          isNull(taskDonePrompts.resolvedAt),
        ),
      );
    const withOpen = new Set(open.map((r) => r.taskId));
    for (const task of tasks.filter((t) => withOpen.has(t.id))) {
      await this.close(tx, task, actor, resolution);
    }
  }
}

const promptNotFound = () => AppException.notFound('Prompt not found.');
const alreadyHandled = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.CONFLICT,
    'This was already handled: the task is done or the prompt was dismissed.',
  );

import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, projects, tasks, type Executor } from '@devtrack/database';
import type { TaskStatus } from '@devtrack/types';
import { EventRecorder } from '../events/event-recorder.service';

/** Statuses automation can move a task to (decision record 0021). Never DONE. */
export type AutomationTarget = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW';

/** What caused an automatic move. Shown in the activity feed; display details only. */
export type AutomationCause =
  | { trigger: 'request' }
  | { trigger: 'commit'; repository: string; sha: string; url: string }
  | { trigger: 'pull_request'; repository: string; prNumber: number; url: string };

export interface AutomationProject {
  id: string;
  workspaceId: string;
  key: string;
}

/** Forward order. BLOCKED and DONE are never left automatically. */
const ORDER: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW'];

/** The statuses a task may be in for automation to move it to `to`. */
export function statusesBefore(to: AutomationTarget): TaskStatus[] {
  return ORDER.slice(0, ORDER.indexOf(to));
}

/** Task numbers in `keys` (`DEV-104`) that carry this project's key. */
export function numbersForProject(projectKey: string, keys: string[]): number[] {
  return keys
    .filter((k) => k.slice(0, k.lastIndexOf('-')) === projectKey.toUpperCase())
    .map((k) => Number(k.slice(k.lastIndexOf('-') + 1)));
}

/**
 * Moves tasks forward from Triage and GitHub events (decision record 0021). Runs inside the
 * caller's transaction. Each move is recorded exactly like a manual one (`task.updated` with
 * `changes.status`), with no actor and `metadata.automation`, so the board, the activity feed
 * and time in status (0011) treat it the same way.
 */
@Injectable()
export class TaskStatusAutomation {
  constructor(private readonly events: EventRecorder) {}

  /** Moves the tasks with these numbers in `project` forward to `to`. Returns how many moved. */
  async advanceByNumbers(
    tx: Executor,
    project: AutomationProject,
    numbers: number[],
    to: AutomationTarget,
    cause: AutomationCause,
  ): Promise<number> {
    if (numbers.length === 0) return 0;
    return this.advance(tx, project, inArray(tasks.taskNumber, numbers), to, cause);
  }

  /** Moves the given tasks of `project` forward to `to`. Returns how many moved. */
  async advanceByIds(
    tx: Executor,
    project: AutomationProject,
    taskIds: string[],
    to: AutomationTarget,
    cause: AutomationCause,
  ): Promise<number> {
    if (taskIds.length === 0) return 0;
    return this.advance(tx, project, inArray(tasks.id, taskIds), to, cause);
  }

  private async advance(
    tx: Executor,
    project: AutomationProject,
    which: ReturnType<typeof inArray>,
    to: AutomationTarget,
    cause: AutomationCause,
  ): Promise<number> {
    const allowed = statusesBefore(to);
    // Locked so a concurrent manual change can't slip between the read and the write.
    const candidates = await tx
      .select({ id: tasks.id, number: tasks.taskNumber, status: tasks.status })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(
        and(
          which,
          eq(tasks.projectId, project.id),
          isNull(tasks.deletedAt),
          inArray(tasks.status, allowed),
          ne(projects.status, 'ARCHIVED'),
        ),
      )
      .for('update', { of: tasks });
    if (candidates.length === 0) return 0;

    await tx
      .update(tasks)
      .set({ status: to, completedAt: null })
      .where(
        inArray(
          tasks.id,
          candidates.map((t) => t.id),
        ),
      );

    for (const task of candidates) {
      const changes = { status: { from: task.status, to } };
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: task.id,
        entity: { type: 'task', id: task.id },
        actor: null,
        action: 'task.updated',
        metadata: { key: `${project.key}-${task.number}`, changes, automation: cause },
        event: { type: 'task.updated', payload: { taskId: task.id, changes } },
      });
    }
    return candidates.length;
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, tasks, type Database } from '@devtrack/database';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import {
  ProjectAccessService,
  type ProjectAccess,
  type ProjectAccessOptions,
} from '../projects/project-access.service';

export type TaskRow = typeof tasks.$inferSelect;

/** Resolves a live (not deleted) task and authorizes through its project. */
@Injectable()
export class TaskAccessService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projects: ProjectAccessService,
  ) {}

  async require(
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
      return { task, access: await this.projects.require(userId, task.projectId, options) };
    } catch (err) {
      // Outsiders must not learn that the task exists.
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw taskNotFound();
      }
      throw err;
    }
  }
}

export const taskNotFound = () => AppException.notFound('Task not found.');

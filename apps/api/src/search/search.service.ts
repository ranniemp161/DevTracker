import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  projectMembers,
  projects,
  sql,
  tasks,
  type Database,
  type SQL,
} from '@devtrack/database';
import type { SearchProject, SearchTask, WorkspaceSearchResponse } from '@devtrack/types';
import { parseWorkspaceSearch } from '@devtrack/validators';
import { escapeLike } from '../common/escape-like';
import { DATABASE } from '../database/database.module';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

const TASK_LIMIT = 20;
const PROJECT_LIMIT = 5;

/** 0 when the condition holds, else 1: sorts matching rows first. */
const firstWhen = (condition: SQL) => sql`case when ${condition} then 0 else 1 end`;

/** Decision record 0017: workspace search across the tasks and projects the caller can open. */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly workspaceAccess: WorkspaceAccessService,
  ) {}

  async search(userId: string, workspaceId: string, raw: string): Promise<WorkspaceSearchResponse> {
    const { membership } = await this.workspaceAccess.require(userId, workspaceId);
    const search = parseWorkspaceSearch(raw);
    if (!search) return { tasks: [], projects: [], hasMoreTasks: false };

    // Same rule as project access (0003, 0013): Owners and Admins see every project.
    const visible: SQL[] = [eq(projects.workspaceId, workspaceId)];
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
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
    const pattern = search.text !== null ? `%${escapeLike(search.text)}%` : null;
    const [taskRows, projectRows] = await Promise.all([
      this.tasks(visible, search, pattern),
      pattern ? this.projects(visible, search.text!, pattern) : Promise.resolve([]),
    ]);

    return {
      tasks: taskRows.slice(0, TASK_LIMIT).map((r): SearchTask => ({
        id: r.id,
        key: `${r.project.key}-${r.taskNumber}`,
        title: r.title,
        status: r.status,
        priority: r.priority,
        project: r.project,
      })),
      projects: projectRows,
      hasMoreTasks: taskRows.length > TASK_LIMIT,
    };
  }

  /**
   * Order: the exact key first, then projects that aren't archived, then number and title
   * matches before description-only ones, then open before Done, then recently updated.
   */
  private tasks(
    visible: SQL[],
    search: NonNullable<ReturnType<typeof parseWorkspaceSearch>>,
    pattern: string | null,
  ) {
    const keyMatch = search.key
      ? and(eq(projects.key, search.key.projectKey), eq(tasks.taskNumber, search.key.number))!
      : null;
    const strong = [
      search.number !== null ? eq(tasks.taskNumber, search.number) : null,
      pattern ? ilike(tasks.title, pattern) : null,
    ].filter((c): c is SQL => c !== null);
    const matches = [
      keyMatch,
      ...strong,
      pattern ? ilike(tasks.description, pattern) : null,
    ].filter((c): c is SQL => c !== null);
    return this.db
      .select({
        id: tasks.id,
        taskNumber: tasks.taskNumber,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        project: {
          id: projects.id,
          key: projects.key,
          name: projects.name,
          status: projects.status,
        },
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...visible, isNull(tasks.deletedAt), or(...matches)))
      .orderBy(
        ...(keyMatch ? [firstWhen(keyMatch)] : []),
        firstWhen(sql`${projects.status} <> 'ARCHIVED'`),
        firstWhen(or(...strong)!),
        firstWhen(sql`${tasks.status} <> 'DONE'`),
        desc(tasks.updatedAt),
        desc(tasks.id),
      )
      .limit(TASK_LIMIT + 1);
  }

  /** Name or key matches; the exact key first, archived projects last. */
  private projects(visible: SQL[], text: string, pattern: string): Promise<SearchProject[]> {
    return this.db
      .select({ id: projects.id, key: projects.key, name: projects.name, status: projects.status })
      .from(projects)
      .where(and(...visible, or(ilike(projects.name, pattern), ilike(projects.key, pattern))))
      .orderBy(
        firstWhen(eq(projects.key, text.toUpperCase())),
        firstWhen(sql`${projects.status} <> 'ARCHIVED'`),
        asc(projects.name),
      )
      .limit(PROJECT_LIMIT);
  }
}

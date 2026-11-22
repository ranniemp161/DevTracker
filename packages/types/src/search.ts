import type { ProjectStatus, TaskPriority, TaskStatus } from './project.js';

/** A project as a search result (decision record 0017). */
export interface SearchProject {
  id: string;
  key: string;
  name: string;
  status: ProjectStatus;
}

/** A task as a search result: enough to recognize and open it. */
export interface SearchTask {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  project: SearchProject;
}

/** GET /workspaces/:id/search?q=: tasks and projects the caller can open. */
export interface WorkspaceSearchResponse {
  tasks: SearchTask[];
  projects: SearchProject[];
  /** More tasks matched than were returned. */
  hasMoreTasks: boolean;
}

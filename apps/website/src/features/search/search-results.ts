import type { SearchProject, SearchTask, WorkspaceSearchResponse } from '@devtrack/types';

/** One row in the search dialog: a task or a project, with where it opens (record 0017). */
export type SearchItem =
  | { kind: 'task'; id: string; href: string; task: SearchTask }
  | { kind: 'project'; id: string; href: string; project: SearchProject };

/** Tasks first, then projects: the order rows show in and ↑/↓ move through. */
export function searchItems(response: WorkspaceSearchResponse | undefined): SearchItem[] {
  if (!response) return [];
  return [
    ...response.tasks.map((task): SearchItem => ({
      kind: 'task',
      id: `task-${task.id}`,
      href: `/projects/${task.project.id}/tasks/${task.id}`,
      task,
    })),
    ...response.projects.map((project): SearchItem => ({
      kind: 'project',
      id: `project-${project.id}`,
      href: `/projects/${project.id}`,
      project,
    })),
  ];
}

/** The next active row for ↑/↓, wrapping at both ends; -1 when there are no rows. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** The API path for a search, or null when there is nothing to search for. */
export function searchPath(workspaceId: string, query: string): string | null {
  const q = query.trim();
  if (!workspaceId || q === '') return null;
  return `/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`;
}

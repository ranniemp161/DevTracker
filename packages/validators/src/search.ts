import { z } from 'zod';

/** Longest workspace search accepted (decision record 0017). */
export const WORKSPACE_SEARCH_MAX_LENGTH = 100;

export const workspaceSearchQuerySchema = z.object({
  q: z.string().trim().max(WORKSPACE_SEARCH_MAX_LENGTH).default(''),
});
export type WorkspaceSearchQuery = z.infer<typeof workspaceSearchQuerySchema>;

/**
 * What a workspace search matches (0017):
 * - `DEV-12`: task 12 of project DEV first, and also text containing "DEV-12".
 * - `#12`: task number 12 in any project, only.
 * - `12`: task number 12 in any project, or text containing "12".
 * - anything else: text in task titles and descriptions, and project names and keys.
 * Returns null for an empty search.
 */
export interface WorkspaceSearch {
  key: { projectKey: string; number: number } | null;
  number: number | null;
  text: string | null;
}

export function parseWorkspaceSearch(raw: string): WorkspaceSearch | null {
  const q = raw.trim().slice(0, WORKSPACE_SEARCH_MAX_LENGTH);
  if (q === '') return null;
  const keyed = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(q);
  if (keyed) {
    return {
      key: { projectKey: keyed[1]!.toUpperCase(), number: Number(keyed[2]) },
      number: null,
      text: q,
    };
  }
  const hashed = /^#(\d{1,9})$/.exec(q);
  if (hashed) return { key: null, number: Number(hashed[1]), text: null };
  if (/^\d{1,9}$/.test(q)) return { key: null, number: Number(q), text: q };
  return { key: null, number: null, text: q };
}

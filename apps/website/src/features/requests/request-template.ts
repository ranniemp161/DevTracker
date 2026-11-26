export type RequestKind = 'bug' | 'request';

/** Starting text for the details box, so senders know what helps the team (0022 UI). */
export const REQUEST_TEMPLATES: Record<RequestKind, string> = {
  bug: '### Steps to reproduce\n1. \n2. \n\n### What I expected\n\n\n### What happened instead\n',
  request: '### The problem\n\n\n### What you would like\n\n\n### Why it matters\n',
};

const isTemplate = (text: string) =>
  Object.values(REQUEST_TEMPLATES).some((t) => t.trim() === text.trim());

/**
 * The details box after switching type: an untouched template (or nothing) becomes the new
 * type's template; anything the sender wrote stays.
 */
export function detailsForKind(current: string, kind: RequestKind): string {
  return current.trim() === '' || isTemplate(current) ? REQUEST_TEMPLATES[kind] : current;
}

/** What is sent: an untouched template counts as no details at all. */
export function detailsToSend(text: string): string {
  return isTemplate(text) ? '' : text;
}

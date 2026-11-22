/** Escapes LIKE wildcards so a search for `50%` or `a_b` matches those characters literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

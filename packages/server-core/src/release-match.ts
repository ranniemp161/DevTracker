/**
 * Decision record 0026 §3: a release matches a milestone when its tag or name equals the
 * milestone's name, trimmed, ignoring case and a leading `v` before a digit (`v1.2` ↔ `1.2`).
 */
export function normalizeReleaseName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^v(?=\d)/, '');
}

export function releaseMatchesMilestone(
  release: { tagName: string; name: string | null },
  milestoneName: string,
): boolean {
  const target = normalizeReleaseName(milestoneName);
  if (!target) return false;
  return (
    normalizeReleaseName(release.tagName) === target ||
    (release.name !== null && normalizeReleaseName(release.name) === target)
  );
}

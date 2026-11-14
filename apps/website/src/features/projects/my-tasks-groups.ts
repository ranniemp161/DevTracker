/** "My tasks" sections, in display order. */
export const DUE_GROUPS = ['overdue', 'today', 'week', 'later', 'none'] as const;
export type DueGroup = (typeof DUE_GROUPS)[number];

export const DUE_GROUP_LABEL: Record<DueGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
  none: 'No due date',
};

/** Local calendar date as YYYY-MM-DD, the format task due dates use. */
export function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return localDate(new Date(y, m - 1, d + days));
}

/** Which section a due date falls in, relative to `today` (both YYYY-MM-DD). */
export function dueGroup(dueDate: string | null, today: string): DueGroup {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate <= addDays(today, 7)) return 'week';
  return 'later';
}

/** Splits tasks into the sections, keeping their order (the API sends them most urgent first). */
export function groupByDue<T extends { dueDate: string | null }>(
  tasks: readonly T[],
  today: string,
): { group: DueGroup; tasks: T[] }[] {
  const byGroup = new Map<DueGroup, T[]>();
  for (const t of tasks) {
    const g = dueGroup(t.dueDate, today);
    byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
  }
  return DUE_GROUPS.filter((g) => byGroup.has(g)).map((g) => ({
    group: g,
    tasks: byGroup.get(g)!,
  }));
}

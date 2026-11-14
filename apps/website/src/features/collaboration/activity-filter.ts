import { ACTIVITY_CATEGORIES, type ActivityCategory } from '@devtrack/validators';

/** Filter chips on the Activity page, in display order. `null` is "All". */
export const ACTIVITY_FILTERS: { value: ActivityCategory | null; label: string; empty: string }[] =
  [
    { value: null, label: 'All', empty: 'No activity yet.' },
    { value: 'tasks', label: 'Tasks', empty: 'No task activity yet.' },
    { value: 'comments', label: 'Comments', empty: 'No comments yet.' },
    { value: 'repository', label: 'Repository', empty: 'No repository activity yet.' },
    { value: 'members', label: 'Members', empty: 'No membership changes yet.' },
  ];

/** `?category=` value, or null (All) when missing or unknown. */
export function parseActivityCategory(value: string | null): ActivityCategory | null {
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(value ?? '')
    ? (value as ActivityCategory)
    : null;
}

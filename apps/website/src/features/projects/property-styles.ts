/** Ghost button showing a property's value and a chevron (SPEC §5 properties panel). */
export const pickerTrigger =
  'flex h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-sm text-fg transition-colors hover:bg-surface-muted aria-expanded:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:min-h-11';

/** Small round "+" next to chips (assignees, labels). */
export const addChip =
  'touch-target inline-flex size-7 items-center justify-center rounded-full border border-dashed border-line-control text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg aria-expanded:bg-surface-muted pointer-coarse:size-9';

/** A property chip in the strip under the task title (task page DNA). */
export const chipTrigger =
  'inline-flex h-7.5 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-label font-medium text-fg transition-colors hover:border-line-control hover:bg-surface-muted aria-expanded:bg-surface-muted disabled:cursor-default disabled:hover:border-line disabled:hover:bg-surface pointer-coarse:h-10';

/** Same look for chips that aren't buttons (assignees, with their own remove button). */
export const chipStatic =
  'inline-flex h-7.5 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-label font-medium text-fg pointer-coarse:h-10';

/**
 * ⋯ button for a row's actions (edit, remove, unlink). Shown on hover or focus of the row
 * (a `group/row` ancestor) with a mouse; always shown on touch screens.
 */
export const rowMenuTrigger =
  'touch-target inline-flex size-7 shrink-0 items-center justify-center rounded-control text-fg-muted opacity-0 transition-opacity hover:bg-surface-muted hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 aria-expanded:bg-surface-muted aria-expanded:opacity-100 pointer-coarse:opacity-100';

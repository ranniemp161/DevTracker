import { z } from 'zod';

const uuid = z.uuid({ error: 'Invalid id.' });

/** YYYY-MM-DD calendar date; `null` clears the value. */
const optionalDate = z.iso.date({ error: 'Use the format YYYY-MM-DD.' }).nullable().optional();

/** 2–10 characters, upper-case letters and digits, starting with a letter (e.g. `DEV`). */
export const projectKeySchema = z
  .string({ error: 'Project key is required.' })
  .trim()
  .toUpperCase()
  .pipe(
    z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, {
      error: 'Use 2–10 letters or digits, starting with a letter (e.g. DEV).',
    }),
  );

const projectName = z
  .string({ error: 'Project name is required.' })
  .trim()
  .min(1, { error: 'Project name is required.' })
  .max(100, { error: 'Project name must be at most 100 characters.' });

const projectDescription = z
  .string()
  .trim()
  .max(5000, { error: 'Description must be at most 5000 characters.' })
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Statuses settable through create/update. ARCHIVED is set only by DELETE. */
export const editableProjectStatusSchema = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED']);

const datesOrdered = (v: { startDate?: string | null; targetDate?: string | null }) =>
  !v.startDate || !v.targetDate || v.targetDate >= v.startDate;
const datesMessage = {
  error: 'Target date must be on or after the start date.',
  path: ['targetDate'],
};

export const createProjectSchema = z
  .object({
    name: projectName,
    key: projectKeySchema,
    description: projectDescription,
    status: editableProjectStatusSchema.optional(),
    startDate: optionalDate,
    targetDate: optionalDate,
  })
  .refine(datesOrdered, datesMessage);
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: projectName.optional(),
    description: projectDescription,
    status: editableProjectStatusSchema.optional(),
    startDate: optionalDate,
    targetDate: optionalDate,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to update.' })
  .refine(datesOrdered, datesMessage);
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const addProjectMemberSchema = z.object({ userId: uuid });
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const taskStatusSchema = z.enum([
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
]);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const taskTitle = z
  .string({ error: 'Title is required.' })
  .trim()
  .min(1, { error: 'Title is required.' })
  .max(200, { error: 'Title must be at most 200 characters.' });

const taskDescription = z
  .string()
  .max(20_000, { error: 'Description must be at most 20,000 characters.' })
  .transform((v) => (v.trim() === '' ? null : v))
  .nullable()
  .optional();

const userIdList = z
  .array(uuid)
  .max(20, { error: 'At most 20 assignees.' })
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/** Longest single time entry: one day. */
export const MAX_ENTRY_MINUTES = 1440;
/** Largest estimate: 1,000 hours. */
export const MAX_ESTIMATE_MINUTES = 60_000;

/**
 * Reads a typed duration into minutes: `1h 30m`, `90m`, `1.5h`, or a bare number of hours.
 * Returns null when the text is not a duration or comes to less than a minute.
 */
export function parseDuration(text: string): number | null {
  const value = text.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return atLeastAMinute(Number(value) * 60);
  const match = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/i.exec(value);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  return atLeastAMinute(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0));
}
const atLeastAMinute = (minutes: number) => (Math.round(minutes) >= 1 ? Math.round(minutes) : null);

/** `null` clears the estimate. */
const estimateMinutes = z
  .number({ error: 'Enter the estimate like 2h 30m.' })
  .int({ error: 'Enter the estimate like 2h 30m.' })
  .min(1, { error: 'The estimate must be at least 1 minute.' })
  .max(MAX_ESTIMATE_MINUTES, { error: 'The estimate must be at most 1,000 hours.' })
  .nullable()
  .optional();

export const createTaskSchema = z.object({
  title: taskTitle,
  description: taskDescription,
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: optionalDate,
  assigneeIds: userIdList.optional(),
  milestoneId: uuid.nullable().optional(),
  estimateMinutes,
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: taskTitle.optional(),
    description: taskDescription,
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: optionalDate,
    /** `null` removes the task from its milestone. */
    milestoneId: uuid.nullable().optional(),
    estimateMinutes,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to update.' });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const changeTaskStatusSchema = z.object({ status: taskStatusSchema });
export type ChangeTaskStatusInput = z.infer<typeof changeTaskStatusSchema>;

export const addAssigneesSchema = z.object({
  userIds: userIdList.refine((ids) => ids.length > 0, { error: 'Choose at least one person.' }),
});
export type AddAssigneesInput = z.infer<typeof addAssigneesSchema>;

/** Most tasks one bulk edit may change (decision record 0003 §8). */
export const BULK_TASK_LIMIT = 100;

/**
 * PATCH /projects/:id/tasks/bulk: the same change applied to many tasks, all or nothing.
 * Only additive or set-to-value changes; deletion stays per task (it depends on the reporter).
 */
export const bulkUpdateTasksSchema = z
  .object({
    taskIds: z
      .array(uuid)
      .min(1, { error: 'Choose at least one task.' })
      .max(BULK_TASK_LIMIT, { error: `At most ${BULK_TASK_LIMIT} tasks at once.` })
      .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    addAssigneeIds: userIdList.optional(),
    addLabelIds: z
      .array(uuid)
      .max(20, { error: 'At most 20 labels.' })
      .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])
      .optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.priority !== undefined ||
      (v.addAssigneeIds?.length ?? 0) > 0 ||
      (v.addLabelIds?.length ?? 0) > 0,
    { error: 'Choose a change to apply.' },
  );
export type BulkUpdateTasksInput = z.infer<typeof bulkUpdateTasksSchema>;

export const TASK_SEARCH_MAX_LENGTH = 100;

/**
 * What a task search matches. A task matches when its number equals `number`, or its title or
 * description contains `text` (case-insensitive). Shared by the API (List) and the website
 * (Board) so both apply the same rules.
 */
export interface TaskSearch {
  number: number | null;
  text: string | null;
}

/**
 * - `DEV-12` (this project's key): task number 12 only.
 * - `#12`: task number 12 only.
 * - `12`: task number 12, or text containing "12".
 * - anything else, including another project's key: text only.
 * Returns null for an empty search.
 */
export function parseTaskSearch(raw: string, projectKey: string): TaskSearch | null {
  const q = raw.trim().slice(0, TASK_SEARCH_MAX_LENGTH);
  if (q === '') return null;
  const keyed = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(q);
  if (keyed && keyed[1]!.toUpperCase() === projectKey.toUpperCase()) {
    return { number: Number(keyed[2]), text: null };
  }
  const hashed = /^#(\d{1,9})$/.exec(q);
  if (hashed) return { number: Number(hashed[1]), text: null };
  if (/^\d{1,9}$/.test(q)) return { number: Number(q), text: q };
  return { number: null, text: q };
}

/** Browser-side twin of the API's search filter. */
export function taskMatchesSearch(
  task: { number: number; title: string; description: string | null },
  search: TaskSearch,
): boolean {
  if (search.number !== null && task.number === search.number) return true;
  if (search.text === null) return false;
  const needle = search.text.toLocaleLowerCase();
  return (
    task.title.toLocaleLowerCase().includes(needle) ||
    (task.description?.toLocaleLowerCase().includes(needle) ?? false)
  );
}

/** Query string for GET /projects/:id/tasks (values arrive as strings). */
export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.union([uuid, z.literal('unassigned')]).optional(),
  labelId: uuid.optional(),
  /** A milestone id, or `none` for tasks without a milestone. */
  milestoneId: z.union([uuid, z.literal('none')]).optional(),
  /** Free-text search; see `parseTaskSearch` for the matching rules. */
  q: z.string().trim().max(TASK_SEARCH_MAX_LENGTH).optional(),
  /**
   * `number`: newest first (default). `status`: Board order (Backlog → … → Blocked), newest
   * first within a status, so a grouped List fills one status at a time.
   */
  sort: z.enum(['number', 'status']).default('number'),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const listProjectsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

// --- Labels (M3 addition) ---

const labelName = z
  .string({ error: 'Label name is required.' })
  .trim()
  .min(1, { error: 'Label name is required.' })
  .max(40, { error: 'Label name must be at most 40 characters.' });

export const labelColorSchema = z
  .string({ error: 'Color is required.' })
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, { error: 'Use a hex color like #2563eb.' }));

export const createLabelSchema = z.object({ name: labelName, color: labelColorSchema });
export type CreateLabelInput = z.infer<typeof createLabelSchema>;

export const updateLabelSchema = z
  .object({ name: labelName.optional(), color: labelColorSchema.optional() })
  .refine((v) => v.name !== undefined || v.color !== undefined, { error: 'Nothing to update.' });
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;

export const attachLabelSchema = z.object({ labelId: uuid });
export type AttachLabelInput = z.infer<typeof attachLabelSchema>;

// --- Milestones (M3 addition) ---

const milestoneName = z
  .string({ error: 'Milestone name is required.' })
  .trim()
  .min(1, { error: 'Milestone name is required.' })
  .max(100, { error: 'Milestone name must be at most 100 characters.' });

export const milestoneStatusSchema = z.enum(['OPEN', 'COMPLETED']);

export const createMilestoneSchema = z.object({
  name: milestoneName,
  description: projectDescription,
  dueDate: optionalDate,
  status: milestoneStatusSchema.optional(),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z
  .object({
    name: milestoneName.optional(),
    description: projectDescription,
    dueDate: optionalDate,
    status: milestoneStatusSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to update.' });
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

// --- Milestone acceptance criteria ---

const criterionText = z
  .string({ error: 'Criterion text is required.' })
  .trim()
  .min(1, { error: 'Criterion text is required.' })
  .max(500, { error: 'Criterion text must be at most 500 characters.' });

export const createMilestoneCriterionSchema = z.object({ text: criterionText });
export type CreateMilestoneCriterionInput = z.infer<typeof createMilestoneCriterionSchema>;

export const updateMilestoneCriterionSchema = z
  .object({
    text: criterionText.optional(),
    done: z.boolean().optional(),
  })
  .refine((v) => v.text !== undefined || v.done !== undefined, { error: 'Nothing to update.' });
export type UpdateMilestoneCriterionInput = z.infer<typeof updateMilestoneCriterionSchema>;

// --- Time entries (decision record 0012) ---

const entryMinutes = z
  .number({ error: 'Enter the time like 1h 30m.' })
  .int({ error: 'Enter the time like 1h 30m.' })
  .min(1, { error: 'Log at least 1 minute.' })
  .max(MAX_ENTRY_MINUTES, { error: 'One entry can hold at most 24 hours.' });

const entryDate = z.iso.date({ error: 'Use the format YYYY-MM-DD.' });

const entryNote = z
  .string()
  .trim()
  .max(500, { error: 'The note must be at most 500 characters.' })
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const createTimeEntrySchema = z.object({
  minutes: entryMinutes,
  spentOn: entryDate,
  note: entryNote,
});
export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

export const updateTimeEntrySchema = z
  .object({
    minutes: entryMinutes.optional(),
    spentOn: entryDate.optional(),
    note: entryNote,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to update.' });
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

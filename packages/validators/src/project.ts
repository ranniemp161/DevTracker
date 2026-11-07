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

export const createTaskSchema = z.object({
  title: taskTitle,
  description: taskDescription,
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: optionalDate,
  assigneeIds: userIdList.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: taskTitle.optional(),
    description: taskDescription,
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: optionalDate,
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: 'Nothing to update.' });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const changeTaskStatusSchema = z.object({ status: taskStatusSchema });
export type ChangeTaskStatusInput = z.infer<typeof changeTaskStatusSchema>;

export const addAssigneesSchema = z.object({
  userIds: userIdList.refine((ids) => ids.length > 0, { error: 'Choose at least one person.' }),
});
export type AddAssigneesInput = z.infer<typeof addAssigneesSchema>;

/** Query string for GET /projects/:id/tasks (values arrive as strings). */
export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.union([uuid, z.literal('unassigned')]).optional(),
  labelId: uuid.optional(),
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

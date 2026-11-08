import { describe, expect, it } from 'vitest';
import {
  createMilestoneCriterionSchema,
  createProjectSchema,
  createTaskSchema,
  listTasksQuerySchema,
  projectKeySchema,
  updateMilestoneCriterionSchema,
  updateProjectSchema,
  updateTaskSchema,
} from './project.js';

describe('projectKeySchema', () => {
  it('upper-cases and accepts valid keys', () => {
    expect(projectKeySchema.parse(' dev ')).toBe('DEV');
    expect(projectKeySchema.parse('Api2')).toBe('API2');
  });
  it.each(['D', '1DEV', 'DEV-1', 'ABCDEFGHIJK', ''])('rejects %j', (key) => {
    expect(projectKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('project schemas', () => {
  it('rejects a target date before the start date', () => {
    const r = createProjectSchema.safeParse({
      name: 'X',
      key: 'XX',
      startDate: '2026-12-01',
      targetDate: '2026-11-01',
    });
    expect(r.success).toBe(false);
  });
  it('never accepts ARCHIVED through create/update', () => {
    expect(
      createProjectSchema.safeParse({ name: 'X', key: 'XX', status: 'ARCHIVED' }).success,
    ).toBe(false);
    expect(updateProjectSchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });
  it('requires at least one field on update and turns empty descriptions into null', () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
    expect(updateProjectSchema.parse({ description: '  ' })).toEqual({ description: null });
  });
});

describe('task schemas', () => {
  it('dedupes assignees and trims titles', () => {
    const id = '7c2d6f0e-3c55-4a8a-9d55-2f3c3b9b1a11';
    expect(createTaskSchema.parse({ title: ' Fix ', assigneeIds: [id, id.toUpperCase()] })).toEqual(
      {
        title: 'Fix',
        assigneeIds: [id],
      },
    );
  });
  it('allows clearing the due date and rejects empty updates', () => {
    expect(updateTaskSchema.parse({ dueDate: null })).toEqual({ dueDate: null });
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });
  it('parses list query strings', () => {
    expect(listTasksQuerySchema.parse({ limit: '25', status: 'DONE' })).toEqual({
      limit: 25,
      status: 'DONE',
    });
    expect(listTasksQuerySchema.parse({}).limit).toBe(50);
    expect(listTasksQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('label and milestone schemas', () => {
  it('normalizes label colors and rejects non-hex values', async () => {
    const { createLabelSchema, updateMilestoneSchema } = await import('./project.js');
    expect(createLabelSchema.parse({ name: ' bug ', color: '#2563EB' })).toEqual({
      name: 'bug',
      color: '#2563eb',
    });
    expect(createLabelSchema.safeParse({ name: 'bug', color: 'red' }).success).toBe(false);
    expect(createLabelSchema.safeParse({ name: '', color: '#000000' }).success).toBe(false);
    expect(updateMilestoneSchema.safeParse({}).success).toBe(false);
    expect(updateMilestoneSchema.parse({ status: 'COMPLETED' })).toEqual({ status: 'COMPLETED' });
  });
});

describe('milestone links and acceptance criteria', () => {
  const id = '3f2b8c1e-6a4d-4e7b-9c2a-1d5e8f7a6b3c';

  it('accepts a milestone id or null on tasks, and a milestone filter', () => {
    expect(createTaskSchema.parse({ title: 'T', milestoneId: id }).milestoneId).toBe(id);
    expect(updateTaskSchema.parse({ milestoneId: null }).milestoneId).toBeNull();
    expect(updateTaskSchema.safeParse({ milestoneId: 'nope' }).success).toBe(false);
    expect(listTasksQuerySchema.parse({ milestoneId: 'none' }).milestoneId).toBe('none');
    expect(listTasksQuerySchema.safeParse({ milestoneId: 'other' }).success).toBe(false);
  });

  it('trims criterion text, rejects blanks and empty updates', () => {
    expect(createMilestoneCriterionSchema.parse({ text: '  Works on mobile ' }).text).toBe(
      'Works on mobile',
    );
    expect(createMilestoneCriterionSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(createMilestoneCriterionSchema.safeParse({ text: 'x'.repeat(501) }).success).toBe(false);
    expect(updateMilestoneCriterionSchema.parse({ done: true })).toEqual({ done: true });
    expect(updateMilestoneCriterionSchema.safeParse({}).success).toBe(false);
  });
});

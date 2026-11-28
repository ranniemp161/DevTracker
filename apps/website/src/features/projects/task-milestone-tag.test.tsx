import type { Milestone } from '@devtrack/types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskMilestoneTag } from './task-milestone-tag';

const mockMilestones: Milestone[] = [
  {
    id: 'm1',
    projectId: 'p1',
    name: 'v1.0 Launch',
    description: null,
    dueDate: null,
    status: 'ACTIVE',
    startedAt: null,
    deliveredAt: null,
    taskCounts: { total: 5, done: 2, addedAfterStart: 0 },
    criteria: [],
    releases: [],
    clientApproval: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'm2',
    projectId: 'p1',
    name: 'A very long milestone name that exceeds normal chip boundaries',
    description: null,
    dueDate: null,
    status: 'ACTIVE',
    startedAt: null,
    deliveredAt: null,
    taskCounts: { total: 2, done: 0, addedAfterStart: 0 },
    criteria: [],
    releases: [],
    clientApproval: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

describe('TaskMilestoneTag (0031 §3 #4, #5)', () => {
  it('renders nothing when milestoneId is null', () => {
    const html = renderToStaticMarkup(
      <TaskMilestoneTag projectId="p1" milestoneId={null} milestones={mockMilestones} />,
    );
    expect(html).toBe('');
  });

  it('renders nothing when milestone is not found in the list', () => {
    const html = renderToStaticMarkup(
      <TaskMilestoneTag projectId="p1" milestoneId="unknown" milestones={mockMilestones} />,
    );
    expect(html).toBe('');
  });

  it('renders milestone flag icon and name when milestone exists', () => {
    const html = renderToStaticMarkup(
      <TaskMilestoneTag projectId="p1" milestoneId="m1" milestones={mockMilestones} />,
    );
    expect(html).toContain('title="Milestone: v1.0 Launch"');
    expect(html).toContain('v1.0 Launch');
    expect(html).toContain('<svg');
    expect(html).toContain('truncate');
  });

  it('includes truncation styling and title tooltip for long milestone names', () => {
    const html = renderToStaticMarkup(
      <TaskMilestoneTag projectId="p1" milestoneId="m2" milestones={mockMilestones} />,
    );
    expect(html).toContain(
      'title="Milestone: A very long milestone name that exceeds normal chip boundaries"',
    );
    expect(html).toContain('A very long milestone name that exceeds normal chip boundaries');
    expect(html).toContain('max-w-28');
  });
});

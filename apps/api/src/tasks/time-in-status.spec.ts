import { describe, expect, it } from 'vitest';
import { timeInStatus } from './time-in-status';

const at = (hour: number) => new Date(Date.UTC(2026, 0, 1, hour));

describe('timeInStatus', () => {
  it('counts an untouched task in its first status up to now', () => {
    const result = timeInStatus({
      createdAt: at(0),
      initialStatus: 'TODO',
      changes: [],
      completedAt: null,
      now: at(2),
    });
    expect(result.totals).toEqual([{ status: 'TODO', seconds: 7200 }]);
    expect(result.currentSince).toBe(at(0).toISOString());
    expect(result.cycleSeconds).toBeNull();
  });

  it('sums repeat visits, in workflow order, and measures cycle time from the first start', () => {
    const result = timeInStatus({
      createdAt: at(0),
      initialStatus: 'TODO',
      changes: [
        { at: at(1), to: 'IN_PROGRESS' },
        { at: at(3), to: 'IN_REVIEW' },
        { at: at(4), to: 'IN_PROGRESS' },
        { at: at(5), to: 'DONE' },
      ],
      completedAt: at(5),
      now: at(8),
    });
    expect(result.totals).toEqual([
      { status: 'TODO', seconds: 3600 },
      { status: 'IN_PROGRESS', seconds: 3 * 3600 },
      { status: 'IN_REVIEW', seconds: 3600 },
      { status: 'DONE', seconds: 3 * 3600 },
    ]);
    expect(result.currentSince).toBe(at(5).toISOString());
    expect(result.cycleSeconds).toBe(4 * 3600);
  });

  it('has no cycle time for a task finished without being started', () => {
    const result = timeInStatus({
      createdAt: at(0),
      initialStatus: 'TODO',
      changes: [{ at: at(1), to: 'DONE' }],
      completedAt: at(1),
      now: at(2),
    });
    expect(result.cycleSeconds).toBeNull();
  });
});

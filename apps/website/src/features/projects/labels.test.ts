import { describe, expect, it } from 'vitest';
import { formatDate, formatDuration, formatMinutes } from './labels';

describe('formatDuration', () => {
  it('reports anything under a minute as under 1m', () => {
    expect(formatDuration(0)).toBe('Under 1m');
    expect(formatDuration(59)).toBe('Under 1m');
  });

  it('shows minutes below an hour, dropping leftover seconds', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(45 * 60 + 59)).toBe('45m');
  });

  it('shows hours and minutes below a day', () => {
    expect(formatDuration(3 * 3600)).toBe('3h');
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe('3h 20m');
  });

  it('shows days and hours, dropping minutes', () => {
    expect(formatDuration(86400)).toBe('1d');
    expect(formatDuration(2 * 86400 + 4 * 3600 + 59 * 60)).toBe('2d 4h');
    expect(formatDuration(2 * 86400 + 59 * 60)).toBe('2d');
  });
});

describe('formatMinutes', () => {
  it('formats effort the way it is typed', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(240)).toBe('4h');
    expect(formatMinutes(270)).toBe('4h 30m');
  });

  it('never rolls hours over into days', () => {
    expect(formatMinutes(25 * 60)).toBe('25h');
  });
});

describe('formatDate', () => {
  it('shows a dash when there is no date', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('keeps the calendar day regardless of time zone', () => {
    const expected = new Date(Date.UTC(2026, 0, 1)).toLocaleDateString(undefined, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    });
    expect(formatDate('2026-01-01')).toBe(expected);
    expect(formatDate('2026-01-01T23:30:00-05:00')).toBe(expected);
  });
});

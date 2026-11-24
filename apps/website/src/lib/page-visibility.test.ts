import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pauseWhileHidden } from './page-visibility';

function fakeDocument(initial: DocumentVisibilityState) {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  };
  const set = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    for (const fn of listeners) fn();
  };
  return { doc: doc as unknown as Document, set, listeners };
}

describe('pauseWhileHidden', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pauses after the grace period and resumes when shown again', () => {
    const { doc, set } = fakeDocument('visible');
    const onPause = vi.fn();
    const onResume = vi.fn();
    pauseWhileHidden(doc, 1000, onPause, onResume);

    set('hidden');
    vi.advanceTimersByTime(999);
    expect(onPause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onPause).toHaveBeenCalledTimes(1);

    set('visible');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('ignores tab switches shorter than the grace period', () => {
    const { doc, set } = fakeDocument('visible');
    const onPause = vi.fn();
    const onResume = vi.fn();
    pauseWhileHidden(doc, 1000, onPause, onResume);

    set('hidden');
    vi.advanceTimersByTime(500);
    set('visible');
    vi.advanceTimersByTime(5000);

    expect(onPause).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('starts the grace period when mounted in a hidden tab', () => {
    const { doc } = fakeDocument('hidden');
    const onPause = vi.fn();
    pauseWhileHidden(doc, 1000, onPause, vi.fn());

    vi.advanceTimersByTime(1000);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('cleanup cancels a pending pause and stops listening', () => {
    const { doc, set, listeners } = fakeDocument('visible');
    const onPause = vi.fn();
    const stop = pauseWhileHidden(doc, 1000, onPause, vi.fn());

    set('hidden');
    stop();
    vi.advanceTimersByTime(5000);

    expect(onPause).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isShortcutBlocked, matchesShortcut } from './shortcuts';

const key = (k: string, extra: Partial<KeyboardEvent> & { tag?: string } = {}) => {
  const { tag = 'BODY', ...rest } = extra;
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: { tagName: tag, isContentEditable: false },
    ...rest,
  } as unknown as KeyboardEvent;
};

const withOpenLayer = (open: boolean) =>
  vi.stubGlobal('document', { querySelector: () => (open ? {} : null) });

afterEach(() => vi.unstubAllGlobals());

describe('keyboard shortcuts', () => {
  it('matches plain keys in either case, and ? with Shift', () => {
    withOpenLayer(false);
    expect(matchesShortcut(key('S'), { key: 's' })).toBe(true);
    expect(matchesShortcut(key('?', { shiftKey: true }), { key: '?' })).toBe(true);
    expect(matchesShortcut(key('j'), { key: 'k' })).toBe(false);
  });

  it('never fires plain keys while typing, but Ctrl/⌘ shortcuts still do', () => {
    withOpenLayer(false);
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isShortcutBlocked(key('s', { tag }))).toBe(true);
      expect(isShortcutBlocked(key('s', { tag, ctrlKey: true }), true)).toBe(false);
    }
  });

  it('needs exactly the modifier the shortcut asks for', () => {
    withOpenLayer(false);
    expect(matchesShortcut(key('s', { ctrlKey: true }), { key: 's' })).toBe(false);
    expect(matchesShortcut(key('s', { metaKey: true }), { key: 's', mod: true })).toBe(true);
    expect(matchesShortcut(key('s'), { key: 's', mod: true })).toBe(false);
    expect(isShortcutBlocked(key('s', { altKey: true }))).toBe(true);
  });

  it('pauses while a menu or dialog is open, or during IME composition', () => {
    withOpenLayer(true);
    expect(isShortcutBlocked(key('s'))).toBe(true);
    withOpenLayer(false);
    expect(isShortcutBlocked(key('s', { isComposing: true }))).toBe(true);
  });
});

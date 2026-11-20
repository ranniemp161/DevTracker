import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { applyThemeChoice, parseThemeChoice, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from './theme';

describe('theme choice', () => {
  it('accepts light and dark, and treats anything else as system', () => {
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
    expect(parseThemeChoice(null)).toBe('system');
    expect(parseThemeChoice('blue')).toBe('system');
  });

  it('the head script reads the same storage key', () => {
    expect(THEME_INIT_SCRIPT).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it.each(['light', 'dark'])('applies saved %s to the root and metadata at startup', (choice) => {
    const documentElement = { dataset: {} };
    const setAttribute = vi.fn();
    const querySelector = vi.fn(() => ({ setAttribute }));

    runInNewContext(THEME_INIT_SCRIPT, {
      document: { documentElement, querySelector },
      localStorage: { getItem: () => choice },
    });

    expect(documentElement.dataset).toEqual({ theme: choice });
    expect(querySelector).toHaveBeenCalledWith('meta[name="color-scheme"]');
    expect(setAttribute).toHaveBeenCalledWith('content', choice);
  });

  it('restores the system scheme when clearing an override', () => {
    const documentElement = { dataset: { theme: 'dark' } };
    const setAttribute = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('document', { documentElement, querySelector: () => ({ setAttribute }) });
    vi.stubGlobal('localStorage', { removeItem });

    try {
      applyThemeChoice('system');

      expect(documentElement.dataset).toEqual({});
      expect(setAttribute).toHaveBeenCalledWith('content', 'light dark');
      expect(removeItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

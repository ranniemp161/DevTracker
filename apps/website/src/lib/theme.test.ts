import { describe, expect, it } from 'vitest';
import { parseThemeChoice, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from './theme';

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
});

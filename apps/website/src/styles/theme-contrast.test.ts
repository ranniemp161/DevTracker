import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Checks the dark theme's text/background token pairs against WCAG AA, reading the values
 * straight from tokens.css so the test fails if someone changes a colour.
 */
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--(dt-[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/g)].map((m) => [m[1]!, m[2]!]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const dark = block(":root[data-theme='dark']");
const t = (name: string) => {
  const value = dark[name];
  if (!value) throw new Error(`--${name} has no hex value in the dark theme`);
  return value;
};

describe('dark theme contrast (WCAG AA)', () => {
  const surfaces = ['dt-surface', 'dt-bg', 'dt-surface-sunken'];
  it.each(['dt-text', 'dt-text-secondary', 'dt-text-muted', 'dt-text-subtle', 'dt-danger'])(
    '%s on every surface ≥ 4.5:1',
    (text) => {
      for (const s of surfaces) expect(contrast(t(text), t(s))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    ['dt-text-on-primary', 'dt-primary'],
    ['dt-primary-soft-text', 'dt-primary-soft'],
    ['dt-text-on-inverse', 'dt-surface-inverse'],
    ['dt-status-backlog-fg', 'dt-status-backlog-bg'],
    ['dt-status-todo-fg', 'dt-status-todo-bg'],
    ['dt-status-progress-fg', 'dt-status-progress-bg'],
    ['dt-status-review-fg', 'dt-status-review-bg'],
    ['dt-status-done-fg', 'dt-status-done-bg'],
    ['dt-status-blocked-fg', 'dt-status-blocked-bg'],
    ['dt-activity-label-fg', 'dt-activity-label-bg'],
    ['dt-avatar-1-fg', 'dt-avatar-1-bg'],
    ['dt-avatar-3-fg', 'dt-avatar-3-bg'],
    ['dt-avatar-5-fg', 'dt-avatar-5-bg'],
  ])('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(t(fg), t(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('control borders stand out from the surface (≥ 3:1)', () => {
    expect(contrast(t('dt-border-control'), t('dt-surface'))).toBeGreaterThanOrEqual(3);
  });

  it('the system-preference block matches the explicit dark block', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    for (const [name, value] of Object.entries(dark)) {
      expect(media).toContain(`--${name}: ${value};`);
    }
  });
});

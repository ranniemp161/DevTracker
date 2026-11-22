import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

const html = (text: string, mentions?: Set<string>) =>
  renderToStaticMarkup(<Markdown mentions={mentions}>{text}</Markdown>);

describe('Markdown (0019)', () => {
  it('renders GitHub-flavoured Markdown', () => {
    const out = html('# Title\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`x`');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('disabled');
    expect(out).toContain('<table>');
    expect(out).toContain('<code>x</code>');
  });

  it('never renders raw HTML or unsafe links', () => {
    const out = html(
      '<script>alert(1)</script><img src=x onerror=alert(1)> [x](javascript:alert(1))',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('javascript:');
  });

  it('opens links in a new tab without opener or referrer', () => {
    expect(html('[docs](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it('highlights only resolved mentions, not inside code', () => {
    const out = html('hi @alice and @bob, `@alice`', new Set(['alice']));
    expect(out).toContain('<span class="font-medium text-primary">@alice</span>');
    expect(out).not.toContain('>@bob</span>');
    expect(out).toContain('<code>@alice</code>');
  });
});

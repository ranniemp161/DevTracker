import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProjectExpanded, toggleFavoriteProject } from './project-prefs';

function fakeStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('sidebar project preferences', () => {
  it('toggles favourites in the order they were added', () => {
    const data = fakeStorage();
    toggleFavoriteProject('a');
    toggleFavoriteProject('b');
    expect(JSON.parse(data.get('devtrack.favoriteProjects')!)).toEqual(['a', 'b']);
    toggleFavoriteProject('a');
    expect(JSON.parse(data.get('devtrack.favoriteProjects')!)).toEqual(['b']);
  });

  it('remembers expanded and collapsed projects, ignoring corrupt values', () => {
    const data = fakeStorage();
    data.set('devtrack.expandedProjects', '{not json');
    setProjectExpanded('a', true);
    setProjectExpanded('b', false);
    expect(JSON.parse(data.get('devtrack.expandedProjects')!)).toEqual({ a: true, b: false });
  });

  it('keeps working when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => toggleFavoriteProject('a')).not.toThrow();
  });
});

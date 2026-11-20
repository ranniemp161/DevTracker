import { describe, expect, it } from 'vitest';
import { pickHomeWorkspace } from './last-workspace';

describe('pickHomeWorkspace', () => {
  it('opens the only workspace', () => {
    expect(pickHomeWorkspace(['a'], null)).toBe('a');
    expect(pickHomeWorkspace(['a'], 'gone')).toBe('a');
  });

  it('reopens the last workspace when the user still belongs to it', () => {
    expect(pickHomeWorkspace(['a', 'b'], 'b')).toBe('b');
  });

  it('shows the picker otherwise', () => {
    expect(pickHomeWorkspace(['a', 'b'], null)).toBeNull();
    expect(pickHomeWorkspace(['a', 'b'], 'gone')).toBeNull();
    expect(pickHomeWorkspace([], 'a')).toBeNull();
  });
});

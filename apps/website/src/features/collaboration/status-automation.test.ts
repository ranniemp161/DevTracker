import type { ActivityEntry } from '@devtrack/types';
import { describe, expect, it } from 'vitest';
import { actorLabel, describeActivity } from './describe-activity';

const move = (automation: Record<string, unknown> | undefined, actor: unknown = null) =>
  ({
    action: 'task.updated',
    actor,
    metadata: {
      changes: { status: { from: 'TODO', to: 'IN_REVIEW' } },
      ...(automation ? { automation } : {}),
    },
  }) as unknown as ActivityEntry;

describe('automatic status moves (0021)', () => {
  it('names DevTrack automation as the actor', () => {
    expect(actorLabel(move({ trigger: 'request' }))).toBe('DevTrack automation');
    expect(actorLabel(move(undefined))).toBe('System');
    expect(actorLabel(move(undefined, { username: 'dev' }))).toBe('@dev');
  });

  it('says what caused the move', () => {
    expect(describeActivity(move({ trigger: 'pull_request', prNumber: 42 }))).toBe(
      'changed status from To do to In review · PR #42',
    );
    expect(describeActivity(move({ trigger: 'commit', sha: 'abcdef1234567890' }))).toBe(
      'changed status from To do to In review · commit abcdef1',
    );
    expect(describeActivity(move({ trigger: 'request' }))).toBe(
      'changed status from To do to In review · request accepted',
    );
    expect(describeActivity(move(undefined))).toBe('changed status from To do to In review');
  });
});

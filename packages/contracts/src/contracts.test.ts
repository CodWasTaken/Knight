import { describe, expect, it } from 'vitest';
import { ACTION_IDS, GuildMode, PolicyDecision } from './index.js';

describe('security contracts', () => {
  it('contains the guarded member ban action', () => {
    expect(ACTION_IDS).toContain('member.ban');
  });

  it('uses explicit policy decisions and modes', () => {
    expect(PolicyDecision.Deny).toBe('DENY');
    expect(GuildMode.Guarded).toBe('GUARDED');
  });
});

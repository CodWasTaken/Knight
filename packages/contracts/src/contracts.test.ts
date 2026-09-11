import { describe, expect, it } from 'vitest';
import { ACTION_IDS, GuildMode, PolicyDecision } from './index.js';

describe('security contracts', () => {
  it('contains the guarded member ban action', () => {
    expect(ACTION_IDS).toContain('member.ban');
    expect(ACTION_IDS).toContain('member.warnings.view');
  });


  it('describes the moderation capability groups and labels', async () => {
    const contracts = (await import('./index.js')) as Record<string, unknown>;

    expect(contracts.RATE_LIMITED_MODERATION_ACTIONS).toEqual([
      'member.warn',
      'member.timeout',
      'member.kick',
      'member.ban',
      'member.unban',
      'message.purge',
    ]);
    expect(contracts.MODERATION_ACTIONS).toEqual([
      'member.warn',
      'member.timeout',
      'member.kick',
      'member.ban',
      'member.unban',
      'message.purge',
    ]);
    expect(contracts.READ_ONLY_ACTIONS).toEqual(['member.warnings.view']);
    expect(contracts.MODERATION_ACTION_METADATA).toMatchObject({
      'member.warn': { label: 'Warn member' },
      'member.timeout': { label: 'Timeout member', nativePermission: 'ModerateMembers' },
      'member.kick': { label: 'Kick member', nativePermission: 'KickMembers' },
      'member.ban': { label: 'Ban member', nativePermission: 'BanMembers' },
      'member.unban': { label: 'Unban member', nativePermission: 'BanMembers' },
      'message.purge': { label: 'Purge messages', nativePermission: 'ManageMessages' },
      'member.warnings.view': { label: 'View warning history', readOnly: true },
    });
  });

  it('uses explicit policy decisions and modes', () => {
    expect(PolicyDecision.Deny).toBe('DENY');
    expect(GuildMode.Guarded).toBe('GUARDED');
  });
});

import { ProtectionLevel, type ActionPolicy } from '@knight/contracts';
import { authorizeGuardedAction } from '@knight/security';
import { describe, expect, it, vi } from 'vitest';
import { executeMemberUnban } from './unban.js';
const unlimited: ActionPolicy = { enabled: true, unlimited: true, rateWindows: [] };
function profile(id: string, rank: number) {
  return {
    id,
    guildId: '100',
    profileId: `p-${id}`,
    version: 1,
    profileName: id,
    discordRoleId: `r-${id}`,
    rank,
    permissions: ['member.unban'] as const,
    actionPolicies: { 'member.unban': unlimited },
  };
}
const input = {
  guildId: '100',
  actorUserId: '42',
  targetUserId: '77',
  knightBotUserId: '999',
  reason: 'appeal accepted',
  nowMs: 10_000,
} as const;
function deps(ownerId = '1') {
  return {
    authorize: authorizeGuardedAction,
    staffProfiles: {
      getEffectiveProfile: vi.fn(async (_g: string, u: string) =>
        u === '42' ? profile('actor', 10) : u === '77' ? profile('target', 20) : null,
      ),
    },
    security: {
      getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal),
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
    rateLimits: { consume: vi.fn().mockResolvedValue({ allowed: true, windows: [] }) },
    decisions: { record: vi.fn().mockResolvedValue(undefined) },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    correlations: { create: vi.fn().mockResolvedValue(undefined) },
    createCorrelationId: vi.fn(() => 'c1'),
    discord: {
      getGuildState: vi
        .fn()
        .mockResolvedValue({
          guildId: '100',
          ownerId,
          knightUserId: '999',
          knightRolePosition: 100,
          knightPermissions: 0n,
          roles: [],
        }),
      getMemberState: vi.fn().mockResolvedValue(null),
      unbanMember: vi.fn().mockResolvedValue(undefined),
    },
  };
}
describe('executeMemberUnban', () => {
  it('protects a higher-ranked banned staff member using durable Knight state', async () => {
    const d = deps();
    const result = await executeMemberUnban(input, d);
    expect(result.executed).toBe(false);
    expect(result.content).toContain('protected');
    expect(d.discord.getMemberState).toHaveBeenCalledWith('100', '77');
    expect(d.discord.unbanMember).not.toHaveBeenCalled();
  });
  it('lets the guild owner unban despite the target durable rank', async () => {
    const d = deps('42');
    d.staffProfiles.getEffectiveProfile.mockImplementation(async (_g: string, u: string) =>
      u === '77' ? profile('target', 99) : null,
    );
    const result = await executeMemberUnban(input, d);
    expect(result.executed).toBe(true);
    expect(d.correlations.create).toHaveBeenCalledTimes(1);
    expect(d.discord.unbanMember).toHaveBeenCalledWith({
      guildId: '100',
      targetUserId: '77',
      reason: 'appeal accepted',
    });
  });
});

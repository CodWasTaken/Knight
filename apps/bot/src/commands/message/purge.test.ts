import {
  PolicyDecision,
  ProtectionLevel,
  type ActionId,
  type SecurityDecision,
} from '@knight/contracts';
import { PermissionsBitField } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { executeMessagePurge } from './purge.js';

const allow: SecurityDecision = {
  decision: PolicyDecision.Allow,
  code: 'ALLOWED',
  reason: 'Allowed.',
  policyVersionId: 'actor-version',
  metadata: {},
};

const input = {
  guildId: '100',
  channelId: 'channel-1',
  actorUserId: '42',
  knightBotUserId: '999',
  count: 10,
  targetUserId: null,
  reason: 'cleanup',
  nowMs: 10_000,
} as const;

function profile(
  userId: string,
  rank: number,
  permissions: readonly ActionId[] = ['message.purge'],
) {
  return {
    id: `${userId}-version`,
    guildId: '100',
    profileId: `${userId}-profile`,
    version: 1,
    profileName: userId,
    discordRoleId: `${userId}-role`,
    rank,
    permissions,
    actionPolicies: { 'message.purge': { enabled: true, unlimited: true, rateWindows: [] } },
  } as const;
}

function makeDependencies(decision: SecurityDecision = allow) {
  const messages = [
    { messageId: 'owner', authorUserId: '1', createdAtMs: 1, bulkDeletable: true },
    { messageId: 'higher', authorUserId: '77', createdAtMs: 2, bulkDeletable: true },
    { messageId: 'lower', authorUserId: '88', createdAtMs: 3, bulkDeletable: true },
    { messageId: 'ordinary', authorUserId: '99', createdAtMs: 4, bulkDeletable: true },
    { messageId: 'elevated', authorUserId: '66', createdAtMs: 5, bulkDeletable: true },
    { messageId: 'old', authorUserId: '99', createdAtMs: 6, bulkDeletable: false },
  ];
  return {
    authorize: vi.fn().mockResolvedValue(decision),
    staffProfiles: {
      getEffectiveProfile: vi.fn(async (_guildId: string, userId: string) => {
        if (userId === '42') return profile('42', 20);
        if (userId === '77') return profile('77', 30);
        if (userId === '88') return profile('88', 10);
        return null;
      }),
    },
    security: { getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal) },
    rateLimits: { consume: vi.fn() },
    decisions: { record: vi.fn() },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    correlations: { create: vi.fn().mockResolvedValue(undefined) },
    createCorrelationId: vi.fn(() => 'corr-1'),
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: '1',
        knightUserId: '999',
        knightRolePosition: 100,
        knightPermissions: 0n,
        roles: [],
      }),
      getMemberState: vi.fn(async (_guildId: string, userId: string) => ({
        userId,
        isGuildOwner: userId === '1',
        roleIds: [],
        highestRolePosition: 1,
        permissions: userId === '66' ? PermissionsBitField.Flags.Administrator : 0n,
      })),
      fetchRecentMessages: vi.fn().mockResolvedValue(messages),
      deleteMessages: vi.fn().mockResolvedValue(2),
    },
  };
}

describe('executeMessagePurge', () => {
  it.each([0, 101])('rejects invalid count %s before authorization or fetch', async (count) => {
    const deps = makeDependencies();
    const result = await executeMessagePurge({ ...input, count }, deps);
    expect(result.executed).toBe(false);
    expect(result.content).toContain('1-100');
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.discord.fetchRecentMessages).not.toHaveBeenCalled();
  });

  it('uses normal target hierarchy for a filtered purge', async () => {
    const deps = makeDependencies({
      ...allow,
      decision: PolicyDecision.Deny,
      code: 'TARGET_OUTRANKS_ACTOR',
      reason: 'protected',
    });
    const result = await executeMessagePurge({ ...input, targetUserId: '77' }, deps);
    expect(result.executed).toBe(false);
    expect(result.content).toContain('protected');
    expect(deps.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message.purge', targetId: '77' }),
      expect.anything(),
    );
    expect(deps.discord.fetchRecentMessages).not.toHaveBeenCalled();
    expect(deps.discord.deleteMessages).not.toHaveBeenCalled();
  });

  it('resource-scopes unfiltered purge and filters protected authors before deletion', async () => {
    const deps = makeDependencies();
    const result = await executeMessagePurge(input, deps);

    expect(result.executed).toBe(true);
    expect(deps.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message.purge', targetId: null }),
      expect.anything(),
    );
    expect(deps.discord.fetchRecentMessages).toHaveBeenCalledWith({
      channelId: 'channel-1',
      limit: 10,
    });
    expect(deps.discord.deleteMessages).toHaveBeenCalledWith({
      channelId: 'channel-1',
      messageIds: ['lower', 'ordinary'],
    });
    expect(result.content).toContain('Deleted 2');
    expect(result.content).toContain('protected 3');
    expect(result.content).toContain('ineligible 1');
    expect(deps.discord.fetchRecentMessages.mock.invocationCallOrder[0]).toBeLessThan(
      deps.correlations.create.mock.invocationCallOrder[0]!,
    );
    expect(deps.correlations.create.mock.invocationCallOrder[0]).toBeLessThan(
      deps.discord.deleteMessages.mock.invocationCallOrder[0]!,
    );
  });

  it('passes a filtered target through planning so unrelated messages are never deleted', async () => {
    const deps = makeDependencies();
    const result = await executeMessagePurge({ ...input, targetUserId: '88' }, deps);
    expect(result.executed).toBe(true);
    expect(deps.discord.deleteMessages).toHaveBeenCalledWith({
      channelId: 'channel-1',
      messageIds: ['lower'],
    });
  });
});

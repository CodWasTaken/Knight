import { ProtectionLevel, type ActionId, type ActionPolicy } from '@knight/contracts';
import { authorizeGuardedAction } from '@knight/security';
import { describe, expect, it, vi } from 'vitest';
import { executeModerationAction } from './moderation-executor.js';

const UNLIMITED: ActionPolicy = { enabled: true, unlimited: true, rateWindows: [] };

function profile(action: ActionId, rank = 20) {
  return {
    id: `version-${rank}`,
    guildId: '100',
    profileId: `profile-${rank}`,
    version: 1,
    profileName: `Staff ${rank}`,
    discordRoleId: `role-${rank}`,
    rank,
    permissions: [action],
    actionPolicies: { [action]: UNLIMITED },
  } as const;
}

function makeDependencies(action: ActionId = 'member.kick') {
  const actor = profile(action);
  return {
    authorize: authorizeGuardedAction,
    staffProfiles: {
      getEffectiveProfile: vi.fn(async (_guildId: string, userId: string) =>
        userId === '42' ? actor : null,
      ),
    },
    security: {
      getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal),
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
    rateLimits: { consume: vi.fn().mockResolvedValue({ allowed: true, windows: [] }) },
    decisions: { record: vi.fn().mockResolvedValue('decision-1') },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    correlations: { create: vi.fn().mockResolvedValue(undefined) },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: '1',
        knightUserId: '999',
        knightRolePosition: 100,
        knightPermissions: 0n,
        roles: [],
      }),
      getMemberState: vi.fn().mockResolvedValue({
        userId: '77',
        isGuildOwner: false,
        roleIds: [],
        highestRolePosition: 1,
        permissions: 0n,
      }),
    },
    createCorrelationId: vi.fn(() => 'corr-1'),
  };
}
const input = {
  guildId: '100',
  actorUserId: '42',
  targetUserId: '77',
  knightBotUserId: '999',
  action: 'member.kick' as const,
  nowMs: 10_000,
  correlation: 'required' as const,
};

describe('executeModerationAction', () => {
  it('does not correlate or mutate when policy denies', async () => {
    const deps = makeDependencies();
    deps.staffProfiles.getEffectiveProfile.mockImplementation(async (_guildId, userId) =>
      userId === '42' ? profile('member.kick', 20) : profile('member.kick', 20),
    );
    const mutation = vi.fn();

    const result = await executeModerationAction(input, deps, mutation);

    expect(result).toMatchObject({ kind: 'DENIED', executed: false });
    expect(deps.correlations.create).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(deps.securityRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.kick',
        decisionId: 'decision-1',
        metadata: expect.objectContaining({ outcome: 'DENIED' }),
      }),
      'MODERATION',
    );
  });

  it('creates a required execution correlation before mutation', async () => {
    const deps = makeDependencies();
    const mutation = vi.fn().mockResolvedValue(undefined);

    const result = await executeModerationAction(input, deps, mutation);

    expect(result).toMatchObject({ kind: 'EXECUTED', executed: true });
    expect(deps.correlations.create).toHaveBeenCalledTimes(1);
    expect(deps.correlations.create.mock.invocationCallOrder[0]).toBeLessThan(
      mutation.mock.invocationCallOrder[0]!,
    );
    expect(deps.securityRecorder.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        decisionId: 'decision-1',
        metadata: expect.objectContaining({ outcome: 'AUTHORIZED' }),
      }),
    );
    expect(deps.securityRecorder.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ metadata: expect.objectContaining({ outcome: 'EXECUTED' }) }),
      'MODERATION',
    );
    expect(deps.securityRecorder.record.mock.invocationCallOrder[0]).toBeLessThan(
      mutation.mock.invocationCallOrder[0]!,
    );
  });

  it('runs an allowed Knight-only mutation without a correlation', async () => {
    const deps = makeDependencies('member.warn');
    const mutation = vi.fn().mockResolvedValue(undefined);

    const result = await executeModerationAction(
      { ...input, action: 'member.warn', correlation: 'none' },
      deps,
      mutation,
    );

    expect(result).toMatchObject({ kind: 'EXECUTED', executed: true });
    expect(deps.correlations.create).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ALLOWED', policyVersionId: 'version-20' }),
    );
  });
  it('fails closed when security state cannot be loaded', async () => {
    const deps = makeDependencies();
    deps.discord.getGuildState.mockRejectedValueOnce(new Error('discord unavailable'));
    const mutation = vi.fn();

    const result = await executeModerationAction(input, deps, mutation);

    expect(result).toEqual({ kind: 'SECURITY_UNAVAILABLE', executed: false });
    expect(deps.correlations.create).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('reports mutation failure after authorization without leaking the exception', async () => {
    const deps = makeDependencies();
    const mutation = vi.fn().mockRejectedValue(new Error('token=private'));

    const result = await executeModerationAction(input, deps, mutation);

    expect(result).toMatchObject({ kind: 'MUTATION_FAILED', executed: false });
    expect(JSON.stringify(result)).not.toContain('token=private');
    expect(deps.correlations.create).toHaveBeenCalledTimes(1);
  });
  it('supports resource-scoped purge with a separate correlation target', async () => {
    const deps = makeDependencies('message.purge');
    const mutation = vi.fn().mockResolvedValue(undefined);

    const result = await executeModerationAction(
      {
        ...input,
        action: 'message.purge',
        targetUserId: null,
        correlationTargetId: 'channel-123',
      },
      deps,
      mutation,
    );

    expect(result).toMatchObject({ kind: 'EXECUTED', executed: true });
    expect(deps.staffProfiles.getEffectiveProfile).toHaveBeenCalledTimes(1);
    expect(deps.discord.getMemberState).not.toHaveBeenCalled();
    expect(deps.correlations.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'message.purge', targetId: 'channel-123' }),
      60_000,
    );
  });

  it('fails closed when a required correlation cannot be created', async () => {
    const deps = makeDependencies();
    deps.correlations.create.mockRejectedValueOnce(new Error('redis unavailable'));
    const mutation = vi.fn();
    expect(await executeModerationAction(input, deps, mutation)).toEqual({
      kind: 'CORRELATION_UNAVAILABLE',
      executed: false,
    });
    expect(mutation).not.toHaveBeenCalled();
  });
});

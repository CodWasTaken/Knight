import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { executeMemberWarn } from './warn.js';

const input = {
  guildId: '100', actorUserId: '42', targetUserId: '77', knightBotUserId: '999',
  reason: 'Repeated spam', nowMs: 10_000,
} as const;

const allowDecision: SecurityDecision = {
  decision: PolicyDecision.Allow, code: 'ALLOWED', reason: 'Allowed.',
  policyVersionId: 'version-actor', metadata: {},
};

function makeDependencies(decision: SecurityDecision = allowDecision) {
  const warning = {
    id: 'warning-1', guildId: '100', targetUserId: '77', actorUserId: '42',
    reason: 'Repeated spam', actorProfileVersionId: 'version-actor',
    dmDeliveryStatus: 'PENDING', createdAt: new Date('2026-09-10T20:00:00Z'),
  };
  return {
    authorize: vi.fn().mockResolvedValue(decision),
    staffProfiles: { getEffectiveProfile: vi.fn().mockResolvedValue(null) },
    rateLimits: { consume: vi.fn() }, decisions: { record: vi.fn() },
    correlations: { create: vi.fn() }, createCorrelationId: vi.fn(() => 'corr-1'),
    discord: {
      getGuildState: vi.fn(), getMemberState: vi.fn(),
      sendDirectMessage: vi.fn().mockResolvedValue(undefined),
    },
    warnings: {
      create: vi.fn().mockResolvedValue(warning),
      setDmDeliveryStatus: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('executeMemberWarn', () => {
  it.each([
    ['PERMISSION_MISSING', 'member.warn'],
    ['TARGET_OUTRANKS_ACTOR', 'protected'],
    ['RATE_LIMIT_EXCEEDED', 'rate limit'],
  ])('does not persist or DM when denied with %s', async (code, expected) => {
    const deps = makeDependencies({ ...allowDecision, decision: PolicyDecision.Deny, code, reason: 'Denied.' });
    const result = await executeMemberWarn(input, deps);
    expect(result.executed).toBe(false);
    expect(result.content.toLowerCase()).toContain(expected.toLowerCase());
    expect(deps.warnings.create).not.toHaveBeenCalled();
    expect(deps.discord.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('persists the warning with the authorizing profile version before attempting DM', async () => {
    const deps = makeDependencies();
    const result = await executeMemberWarn(input, deps);

    expect(result.executed).toBe(true);
    expect(deps.warnings.create).toHaveBeenCalledWith({
      guildId: '100', targetUserId: '77', actorUserId: '42', reason: 'Repeated spam',
      actorProfileVersionId: 'version-actor',
    });
    expect(deps.correlations.create).not.toHaveBeenCalled();
    expect(deps.discord.sendDirectMessage).toHaveBeenCalledWith({
      userId: '77', content: expect.stringContaining('Repeated spam'),
    });
    expect(deps.warnings.setDmDeliveryStatus).toHaveBeenCalledWith('100', 'warning-1', 'DELIVERED');
    expect(deps.warnings.create.mock.invocationCallOrder[0]).toBeLessThan(
      deps.discord.sendDirectMessage.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps the durable warning when DM delivery fails and records FAILED', async () => {
    const deps = makeDependencies();
    deps.discord.sendDirectMessage.mockRejectedValueOnce(new Error('token=private blocked DMs'));
    const result = await executeMemberWarn(input, deps);

    expect(result.executed).toBe(true);
    expect(result.content).toContain('warning was saved');
    expect(result.content).toContain('DM');
    expect(result.content).not.toContain('token=private');
    expect(deps.warnings.setDmDeliveryStatus).toHaveBeenCalledWith('100', 'warning-1', 'FAILED');
  });

  it('does not attempt DM when durable warning persistence fails', async () => {
    const deps = makeDependencies();
    deps.warnings.create.mockRejectedValueOnce(new Error('database secret=abc'));
    const result = await executeMemberWarn(input, deps);

    expect(result.executed).toBe(false);
    expect(result.content).toContain('could not be saved');
    expect(result.content).not.toContain('secret=abc');
    expect(deps.discord.sendDirectMessage).not.toHaveBeenCalled();
  });
});

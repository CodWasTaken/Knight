import { PolicyDecision, ProtectionLevel, type SecurityDecision } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { executeMemberKick } from './kick.js';
const allow: SecurityDecision = {
  decision: PolicyDecision.Allow,
  code: 'ALLOWED',
  reason: 'Allowed.',
  policyVersionId: 'v1',
  metadata: {},
};
const input = {
  guildId: '100',
  actorUserId: '42',
  targetUserId: '77',
  knightBotUserId: '999',
  reason: 'raid',
  nowMs: 10_000,
} as const;
function deps(decision: SecurityDecision = allow) {
  return {
    authorize: vi.fn().mockResolvedValue(decision),
    staffProfiles: { getEffectiveProfile: vi.fn() },
    security: {
      getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal),
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
    rateLimits: { consume: vi.fn() },
    decisions: { record: vi.fn() },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    correlations: { create: vi.fn().mockResolvedValue(undefined) },
    createCorrelationId: vi.fn(() => 'c1'),
    discord: {
      getGuildState: vi.fn(),
      getMemberState: vi.fn(),
      kickMember: vi.fn().mockResolvedValue(undefined),
    },
  };
}
describe('executeMemberKick', () => {
  it('uses member.kick and correlates before Discord mutation', async () => {
    const d = deps();
    const result = await executeMemberKick(input, d);
    expect(result.executed).toBe(true);
    expect(d.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.kick' }),
      expect.anything(),
    );
    expect(d.correlations.create.mock.invocationCallOrder[0]).toBeLessThan(
      d.discord.kickMember.mock.invocationCallOrder[0]!,
    );
  });
  it('blocks rate-exhausted kicks without mutation', async () => {
    const d = deps({
      ...allow,
      decision: PolicyDecision.Deny,
      code: 'RATE_LIMIT_EXCEEDED',
      reason: 'limited',
    });
    const result = await executeMemberKick(input, d);
    expect(result.executed).toBe(false);
    expect(result.content).toContain('rate limit');
    expect(d.discord.kickMember).not.toHaveBeenCalled();
  });
});

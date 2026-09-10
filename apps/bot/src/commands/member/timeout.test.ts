import { PolicyDecision, type SecurityDecision } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { executeMemberTimeout } from './timeout.js';

const allow: SecurityDecision = { decision: PolicyDecision.Allow, code: 'ALLOWED', reason: 'Allowed.', policyVersionId: 'v1', metadata: {} };
const input = { guildId: '100', actorUserId: '42', targetUserId: '77', knightBotUserId: '999', duration: '1h', reason: 'cool down', nowMs: 10_000 } as const;
function deps(decision: SecurityDecision = allow) {
  return {
    authorize: vi.fn().mockResolvedValue(decision), staffProfiles: { getEffectiveProfile: vi.fn() },
    rateLimits: { consume: vi.fn() }, decisions: { record: vi.fn() },
    correlations: { create: vi.fn().mockResolvedValue(undefined) }, createCorrelationId: vi.fn(() => 'c1'),
    discord: { getGuildState: vi.fn(), getMemberState: vi.fn(), timeoutMember: vi.fn().mockResolvedValue(undefined) },
  };
}
describe('executeMemberTimeout', () => {
  it('rejects invalid duration before authorization or mutation', async () => {
    const d = deps(); const result = await executeMemberTimeout({ ...input, duration: '29d' }, d);
    expect(result.executed).toBe(false); expect(result.content).toContain('Invalid timeout duration');
    expect(d.authorize).not.toHaveBeenCalled(); expect(d.discord.timeoutMember).not.toHaveBeenCalled();
  });
  it('authorizes member.timeout, correlates, then mutates with parsed milliseconds', async () => {
    const d = deps(); const result = await executeMemberTimeout(input, d);
    expect(result.executed).toBe(true);
    expect(d.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'member.timeout' }), expect.anything());
    expect(d.discord.timeoutMember).toHaveBeenCalledWith({ guildId: '100', targetUserId: '77', durationMs: 3_600_000, reason: 'cool down' });
    expect(d.correlations.create.mock.invocationCallOrder[0]).toBeLessThan(d.discord.timeoutMember.mock.invocationCallOrder[0]!);
  });
  it('does not mutate a protected target denial', async () => {
    const d = deps({ ...allow, decision: PolicyDecision.Deny, code: 'TARGET_OUTRANKS_ACTOR', reason: 'protected' });
    const result = await executeMemberTimeout(input, d);
    expect(result.executed).toBe(false); expect(result.content).toContain('protected');
    expect(d.correlations.create).not.toHaveBeenCalled(); expect(d.discord.timeoutMember).not.toHaveBeenCalled();
  });
  it('sanitizes Discord mutation failure', async () => {
    const d = deps(); d.discord.timeoutMember.mockRejectedValueOnce(new Error('token=secret'));
    const result = await executeMemberTimeout(input, d);
    expect(result.executed).toBe(false); expect(result.content).toContain('Discord rejected'); expect(result.content).not.toContain('secret');
  });
});

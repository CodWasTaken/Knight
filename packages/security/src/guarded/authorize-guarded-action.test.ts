import { PolicyDecision, ProtectionLevel, type StaffProfileSnapshot } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { authorizeGuardedAction } from './authorize-guarded-action.js';
import type {
  GuardedActionContext,
  GuardedActionPorts,
  GuardedActionRequest,
  RateLimitResult,
} from './ports.js';

const moderator: StaffProfileSnapshot = {
  guildId: '100',
  profileId: 'mod',
  profileVersionId: 'mod-v1',
  discordRoleId: '900',
  rank: 20,
  permissions: ['member.ban'],
  actionPolicies: {},
};

const request: GuardedActionRequest = {
  guildId: '100',
  actorUserId: '42',
  action: 'member.ban',
  targetId: '77',
  nowMs: 1_000,
};
const baseContext: GuardedActionContext = {
  action: 'member.ban',
  actor: {
    userId: '42',
    isGuildOwner: false,
    profile: moderator,
    temporaryGrants: [],
    temporaryRestrictions: [],
  },
  target: {
    userId: '77',
    isGuildOwner: false,
    knightRank: 0,
    elevatedUnregistered: false,
    protectionLevel: ProtectionLevel.Normal,
  },
  emergency: { mode: 'NORMAL', lockedScopes: [] },
  actionPolicy: {
    enabled: true,
    unlimited: false,
    rateWindows: [{ max: 2, windowMs: 30 * 60_000 }],
  },
};

const allowedRate: RateLimitResult = {
  allowed: true,
  windows: [{ max: 2, windowMs: 30 * 60_000, used: 1, remaining: 1, resetAtMs: 1_801_000 }],
};
function makePorts(
  context: GuardedActionContext = baseContext,
  rate: RateLimitResult = allowedRate,
): GuardedActionPorts {
  return {
    staffState: {
      getContext: vi.fn().mockResolvedValue(context),
    },
    rateLimits: {
      consume: vi.fn().mockResolvedValue(rate),
    },
    decisions: {
      record: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('authorizeGuardedAction', () => {
  it('denies an exhausted rate limit and records one durable decision', async () => {
    const ports = makePorts(baseContext, {
      allowed: false,
      windows: [{ max: 2, windowMs: 30 * 60_000, used: 2, remaining: 0, resetAtMs: 1_801_000 }],
    });

    const result = await authorizeGuardedAction(request, ports);

    expect(result).toMatchObject({ decision: PolicyDecision.Deny, code: 'RATE_LIMIT_EXCEEDED' });
    expect(ports.rateLimits.consume).toHaveBeenCalledTimes(1);
    expect(ports.decisions.record).toHaveBeenCalledTimes(1);
    expect(ports.decisions.record).toHaveBeenCalledWith(request, result);
  });

  it('skips rate limiting when base policy already denies', async () => {
    const ports = makePorts({
      ...baseContext,
      actor: {
        ...baseContext.actor,
        profile: { ...moderator, permissions: [] },
      },
    });

    const result = await authorizeGuardedAction(request, ports);

    expect(result).toMatchObject({ decision: PolicyDecision.Deny, code: 'PERMISSION_MISSING' });
    expect(ports.rateLimits.consume).not.toHaveBeenCalled();
    expect(ports.decisions.record).toHaveBeenCalledTimes(1);
    expect(ports.decisions.record).toHaveBeenCalledWith(request, result);
  });

  it('fails closed when the rate-limit dependency is unavailable', async () => {
    const ports = makePorts();
    vi.mocked(ports.rateLimits.consume).mockRejectedValueOnce(new Error('redis unavailable'));

    const result = await authorizeGuardedAction(request, ports);
    expect(result).toMatchObject({ decision: PolicyDecision.Deny, code: 'DEPENDENCY_UNAVAILABLE' });
    expect(ports.decisions.record).toHaveBeenCalledTimes(1);
    expect(ports.decisions.record).toHaveBeenCalledWith(request, result);
  });

  it('returns ALLOW with rate metadata when both policy layers pass', async () => {
    const ports = makePorts();

    const result = await authorizeGuardedAction(request, ports);

    expect(result).toMatchObject({
      decision: PolicyDecision.Allow,
      code: 'ALLOWED',
      metadata: { rate: allowedRate },
    });
    expect(ports.rateLimits.consume).toHaveBeenCalledWith(
      'guild:100:user:42:member.ban',
      baseContext.actionPolicy.rateWindows,
      request.nowMs,
    );
    expect(ports.decisions.record).toHaveBeenCalledTimes(1);
    expect(ports.decisions.record).toHaveBeenCalledWith(request, result);
  });
  it('fails closed when the action policy is disabled', async () => {
    const ports = makePorts({
      ...baseContext,
      actionPolicy: { enabled: false, unlimited: false, rateWindows: [] },
    });

    const result = await authorizeGuardedAction(request, ports);

    expect(result).toMatchObject({ decision: PolicyDecision.Deny, code: 'ACTION_DISABLED' });
    expect(ports.rateLimits.consume).not.toHaveBeenCalled();
    expect(ports.decisions.record).toHaveBeenCalledWith(request, result);
  });
});

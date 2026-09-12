import { PolicyDecision, ProtectionLevel, type SecurityDecision } from '@knight/contracts';
import { PermissionsBitField } from 'discord.js';
import type {
  GuardedActionContext,
  GuardedActionPorts,
  GuardedActionRequest,
} from '@knight/security';
import { describe, expect, it, vi } from 'vitest';
import { executeMemberBan } from './ban.js';

const input = {
  guildId: '100',
  actorUserId: '42',
  targetUserId: '77',
  knightBotUserId: '999',
  reason: 'Scam links',
  nowMs: 10_000,
} as const;

const allowDecision: SecurityDecision = {
  decision: PolicyDecision.Allow,
  code: 'ALLOWED',
  reason: 'Allowed.',
  policyVersionId: 'version-1',
  metadata: {},
};

const denyDecision: SecurityDecision = {
  ...allowDecision,
  decision: PolicyDecision.Deny,
  code: 'PERMISSION_MISSING',
  reason: 'Missing permission.',
};

function makeDependencies(decision: SecurityDecision = allowDecision) {
  return {
    authorize: vi.fn().mockResolvedValue(decision),
    staffProfiles: {
      getEffectiveProfile: vi.fn().mockResolvedValue(null),
    },
    security: { getProtectionLevel: vi.fn().mockResolvedValue(ProtectionLevel.Normal) },
    rateLimits: {
      consume: vi.fn(),
    },
    decisions: {
      record: vi.fn(),
    },
    securityRecorder: {
      record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }),
    },
    correlations: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: '1',
        knightUserId: '999',
        knightRolePosition: 100,
        knightPermissions: 0n,
        roles: [],
      }),
      getMemberState: vi.fn().mockResolvedValue(null),
      banMember: vi.fn().mockResolvedValue(undefined),
    },
    createCorrelationId: vi.fn(() => 'corr-1'),
  };
}

describe('executeMemberBan', () => {
  it('never mutates Discord when authorization denies', async () => {
    const deps = makeDependencies(denyDecision);

    const result = await executeMemberBan(input, deps);

    expect(result.executed).toBe(false);
    expect(result.content).toContain('member.ban');
    expect(deps.correlations.create).not.toHaveBeenCalled();
    expect(deps.discord.banMember).not.toHaveBeenCalled();
  });

  it('creates the execution correlation before the Discord ban', async () => {
    const deps = makeDependencies();

    const result = await executeMemberBan(input, deps);

    expect(result.executed).toBe(true);
    expect(deps.correlations.create).toHaveBeenCalledTimes(1);
    expect(deps.discord.banMember).toHaveBeenCalledTimes(1);
    const correlationOrder = deps.correlations.create.mock.invocationCallOrder[0]!;
    const discordOrder = deps.discord.banMember.mock.invocationCallOrder[0]!;
    expect(correlationOrder).toBeLessThan(discordOrder);
  });

  it('marks an unregistered target with native Administrator as elevated', async () => {
    const deps = makeDependencies(denyDecision);
    let observed: GuardedActionContext | undefined;

    deps.staffProfiles.getEffectiveProfile.mockResolvedValueOnce({
      id: 'version-1',
      guildId: '100',
      profileId: 'profile-1',
      version: 1,
      permissions: ['member.ban'],
      actionPolicies: {},
      discordRoleId: 'role-1',
      rank: 20,
    });
    deps.discord.getMemberState.mockResolvedValueOnce({
      userId: '77',
      isGuildOwner: false,
      roleIds: ['admin-role'],
      highestRolePosition: 80,
      permissions: PermissionsBitField.Flags.Administrator,
    });
    deps.authorize.mockImplementationOnce(
      async (request: GuardedActionRequest, ports: GuardedActionPorts) => {
        observed = await ports.staffState.getContext(request);
        return denyDecision;
      },
    );

    await executeMemberBan(input, deps);
    expect(observed?.target!.elevatedUnregistered).toBe(true);
    expect(observed?.target!.knightRank).toBeNull();
  });

  it('defaults a missing action policy to disabled', async () => {
    const deps = makeDependencies(denyDecision);
    let observed: GuardedActionContext | undefined;
    deps.staffProfiles.getEffectiveProfile.mockResolvedValueOnce({
      id: 'version-1',
      guildId: '100',
      profileId: 'profile-1',
      version: 1,
      permissions: ['member.ban'],
      actionPolicies: {},
      discordRoleId: 'role-1',
      rank: 20,
    });
    deps.authorize.mockImplementationOnce(
      async (request: GuardedActionRequest, ports: GuardedActionPorts) => {
        observed = await ports.staffState.getContext(request);
        return denyDecision;
      },
    );

    await executeMemberBan(input, deps);
    expect(observed?.actionPolicy).toEqual({
      enabled: false,
      unlimited: false,
      rateWindows: [],
    });
  });

  it('renders a readable rate-limit denial without leaking internals', async () => {
    const deps = makeDependencies({
      ...denyDecision,
      code: 'RATE_LIMIT_EXCEEDED',
      metadata: {
        rate: {
          allowed: false,
          windows: [{ max: 2, windowMs: 1_800_000, used: 2, remaining: 0, resetAtMs: 70_000 }],
        },
      },
    });

    const result = await executeMemberBan(input, deps);

    expect(result.content).toContain('rate limit');
    expect(result.content).toContain('2/2');
    expect(result.content).not.toContain('stack');
    expect(deps.discord.banMember).not.toHaveBeenCalled();
  });
});

describe('executeMemberBan failure boundaries', () => {
  it('does not ban when the execution correlation cannot be persisted', async () => {
    const deps = makeDependencies();
    deps.correlations.create.mockRejectedValueOnce(new Error('redis unavailable secret=abc'));

    const result = await executeMemberBan(input, deps);

    expect(result.executed).toBe(false);
    expect(deps.discord.banMember).not.toHaveBeenCalled();
    expect(result.content).not.toContain('secret=abc');
  });

  it('sanitizes Discord mutation failures after authorization', async () => {
    const deps = makeDependencies();
    deps.discord.banMember.mockRejectedValueOnce(new Error('token=private Missing Permissions'));

    const result = await executeMemberBan(input, deps);

    expect(deps.correlations.create).toHaveBeenCalledTimes(1);
    expect(result.executed).toBe(false);
    expect(result.content).toContain('Discord rejected');
    expect(result.content).not.toContain('token=private');
  });
  it('does not mutate when policy requires approval', async () => {
    const deps = makeDependencies({
      ...allowDecision,
      decision: PolicyDecision.RequireApproval,
      code: 'APPROVAL_REQUIRED',
      reason: 'Approval required.',
    });

    const result = await executeMemberBan(input, deps);

    expect(result.executed).toBe(false);
    expect(result.content).toContain('requires approval');
    expect(deps.correlations.create).not.toHaveBeenCalled();
    expect(deps.discord.banMember).not.toHaveBeenCalled();
  });
});

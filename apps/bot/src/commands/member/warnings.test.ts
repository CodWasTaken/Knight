import type { ActionId } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { executeMemberWarnings } from './warnings.js';

const input = { guildId: '100', actorUserId: '42', targetUserId: '77', nowMs: 10_000 } as const;

function profile(id: string, rank: number, permissions: readonly ActionId[]) {
  return {
    id, guildId: '100', profileId: `profile-${id}`, version: 1, profileName: id,
    discordRoleId: `role-${id}`, rank, permissions, actionPolicies: {},
  };
}

function warning(id: string, reason: string, minute: number) {
  return {
    id, guildId: '100', targetUserId: '77', actorUserId: '55', reason,
    actorProfileVersionId: null, dmDeliveryStatus: 'DELIVERED',
    createdAt: new Date(Date.UTC(2026, 8, 10, 20, minute)),
  };
}

function makeDependencies(actorPermissions: readonly ActionId[] = ['member.warnings.view']) {
  const actor = profile('actor-version', 10, actorPermissions);
  const target = profile('target-version', 99, []);
  return {
    staffProfiles: {
      getEffectiveProfile: vi.fn(async (_guildId: string, userId: string) =>
        userId === '42' ? actor : userId === '77' ? target : null,
      ),
    },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100', ownerId: '1', knightUserId: '999', knightRolePosition: 100,
        knightPermissions: 0n, roles: [],
      }),
      getMemberState: vi.fn().mockResolvedValue({
        userId: '77', isGuildOwner: false, roleIds: [], highestRolePosition: 99, permissions: 0n,
      }),
    },
    warnings: { listForUser: vi.fn().mockResolvedValue([warning('w2', 'Newest', 2), warning('w1', 'Older', 1)]) },
  };
}

describe('executeMemberWarnings', () => {
  it('allows warning-history access regardless of the target Knight rank', async () => {
    const deps = makeDependencies();
    const result = await executeMemberWarnings(input, deps);
    expect(result.allowed).toBe(true);
    expect(result.content.indexOf('Newest')).toBeLessThan(result.content.indexOf('Older'));
    expect(deps.warnings.listForUser).toHaveBeenCalledWith('100', '77');
  });

  it('denies staff without member.warnings.view and never reads history', async () => {
    const deps = makeDependencies([]);
    const result = await executeMemberWarnings(input, deps);
    expect(result.allowed).toBe(false);
    expect(result.content).toContain('member.warnings.view');
    expect(deps.warnings.listForUser).not.toHaveBeenCalled();
  });

  it('allows the guild owner without a Staff Profile', async () => {
    const deps = makeDependencies([]);
    deps.discord.getGuildState.mockResolvedValueOnce({
      guildId: '100', ownerId: '42', knightUserId: '999', knightRolePosition: 100,
      knightPermissions: 0n, roles: [],
    });
    deps.staffProfiles.getEffectiveProfile.mockResolvedValue(null);
    const result = await executeMemberWarnings(input, deps);
    expect(result.allowed).toBe(true);
    expect(deps.warnings.listForUser).toHaveBeenCalledTimes(1);
  });

  it('safely truncates long histories to a Discord-reply-sized payload', async () => {
    const deps = makeDependencies();
    deps.warnings.listForUser.mockResolvedValue(
      Array.from({ length: 30 }, (_, index) => warning(`w${index}`, `Reason ${index} ${'x'.repeat(120)}`, index)),
    );
    const result = await executeMemberWarnings(input, deps);
    expect(result.allowed).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(1900);
    expect(result.content).toContain('more warning');
  });
});

import type { ActionPolicies } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  updateStaffProfilePolicy,
  type StaffProfilePolicyDependencies,
} from './staff-profile-service';

const profileId = '11111111-1111-4111-8111-111111111111';
const otherProfileId = '22222222-2222-4222-8222-222222222222';
const thirtyMinutes = 30 * 60_000;

const currentPolicies: ActionPolicies = {
  'member.ban': {
    enabled: true,
    unlimited: false,
    rateWindows: [{ max: 2, windowMs: thirtyMinutes }],
  },
};

function makeDependencies(): StaffProfilePolicyDependencies {
  return {
    guilds: { get: vi.fn().mockResolvedValue({ ownerId: 'owner' }) },
    managers: { isSecurityManager: vi.fn().mockResolvedValue(false) },
    staff: {
      getCurrentProfileVersion: vi.fn().mockResolvedValue({
        id: 'version-1',
        guildId: '100',
        profileId,
        version: 1,
        permissions: ['member.ban'],
        actionPolicies: currentPolicies,
        rank: 20,
        discordRoleId: 'role-mod',
      }),
      getEffectiveProfile: vi.fn().mockResolvedValue({
        id: 'actor-version',
        guildId: '100',
        profileId: otherProfileId,
        version: 3,
        permissions: ['member.ban', 'member.kick'],
        actionPolicies: {
          'member.ban': {
            enabled: true,
            unlimited: false,
            rateWindows: [{ max: 10, windowMs: thirtyMinutes }],
          },
        },
        rank: 50,
      }),
      getActiveAssignment: vi.fn().mockResolvedValue(null),
      createProfileVersion: vi.fn().mockImplementation(async (input) => ({
        id: 'version-2',
        guildId: input.guildId,
        profileId: input.profileId,
        version: 2,
        permissions: input.permissions,
        actionPolicies: input.actionPolicies,
      })),
    },
  };
}

const updateInput = {
  guildId: '100',
  profileId,
  permissions: ['member.ban'] as const,
  banWindows: [{ max: 5, windowMs: thirtyMinutes }],
};

describe('updateStaffProfilePolicy', () => {
  it('creates v2 with a higher owner-approved ban limit while preserving v1', async () => {
    const deps = makeDependencies();
    const before = await deps.staff.getCurrentProfileVersion('100', profileId);

    const result = await updateStaffProfilePolicy(updateInput, { userId: 'owner' }, deps);

    expect(result.version).toBe(2);
    expect(result.actionPolicies['member.ban']?.rateWindows).toEqual([
      { max: 5, windowMs: thirtyMinutes },
    ]);
    expect(before?.version).toBe(1);
    expect(before?.actionPolicies['member.ban']?.rateWindows).toEqual([
      { max: 2, windowMs: thirtyMinutes },
    ]);
    expect(deps.staff.createProfileVersion).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: '100', profileId, createdBy: 'owner' }),
    );
  });

  it('denies a Security Manager from increasing a profile that governs them', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);
    deps.staff.getActiveAssignment = vi.fn().mockResolvedValue({
      id: 'assignment-1',
      guildId: '100',
      userId: 'manager',
      profileId,
      profileName: 'Moderator',
      discordRoleId: 'role-mod',
      profileRank: 20,
      syncStatus: 'SYNCED',
    });

    await expect(
      updateStaffProfilePolicy(updateInput, { userId: 'manager' }, deps),
    ).rejects.toMatchObject({ code: 'SELF_ESCALATION_DENIED' });
    expect(deps.staff.createProfileVersion).not.toHaveBeenCalled();
  });

  it('allows the guild owner to increase a profile even if it governs them', async () => {
    const deps = makeDependencies();
    deps.staff.getActiveAssignment = vi.fn().mockResolvedValue({
      id: 'assignment-owner',
      guildId: '100',
      userId: 'owner',
      profileId,
      profileName: 'Moderator',
      discordRoleId: 'role-mod',
      profileRank: 20,
      syncStatus: 'SYNCED',
    });

    await expect(
      updateStaffProfilePolicy(updateInput, { userId: 'owner' }, deps),
    ).resolves.toMatchObject({ version: 2 });
  });

  it('rejects a cross-guild profile UUID without creating a version', async () => {
    const deps = makeDependencies();
    deps.staff.getCurrentProfileVersion = vi.fn().mockResolvedValue(null);
    await expect(
      updateStaffProfilePolicy(updateInput, { userId: 'owner' }, deps),
    ).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' });
    expect(deps.staff.createProfileVersion).not.toHaveBeenCalled();
  });

  it('denies a non-owner, non-manager before profile lookup', async () => {
    const deps = makeDependencies();

    await expect(
      updateStaffProfilePolicy(updateInput, { userId: 'stranger' }, deps),
    ).rejects.toMatchObject({ code: 'STAFF_MANAGEMENT_DENIED' });
    expect(deps.staff.getCurrentProfileVersion).not.toHaveBeenCalled();
  });

  it('enforces a Security Manager grant ceiling when editing another profile', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);
    deps.staff.getEffectiveProfile = vi.fn().mockResolvedValue({
      id: 'actor-version',
      guildId: '100',
      profileId: otherProfileId,
      version: 3,
      permissions: ['member.ban'],
      actionPolicies: {
        'member.ban': {
          enabled: true,
          unlimited: false,
          rateWindows: [{ max: 4, windowMs: thirtyMinutes }],
        },
      },
      rank: 50,
    });

    await expect(
      updateStaffProfilePolicy(updateInput, { userId: 'manager' }, deps),
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' });
    expect(deps.staff.createProfileVersion).not.toHaveBeenCalled();
  });

  it('rejects more than three ban windows before reading guild state', async () => {
    const deps = makeDependencies();
    const invalid = {
      ...updateInput,
      banWindows: [
        { max: 1, windowMs: 60_000 },
        { max: 2, windowMs: 120_000 },
        { max: 3, windowMs: 180_000 },
        { max: 4, windowMs: 240_000 },
      ],
    };

    await expect(
      updateStaffProfilePolicy(invalid, { userId: 'owner' }, deps),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(deps.guilds.get).not.toHaveBeenCalled();
  });
});

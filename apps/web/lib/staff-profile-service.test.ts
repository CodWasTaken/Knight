import { GuildMode, type ActionPolicies } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  createStaffProfileFromDashboard,
  updateStaffProfileFromDashboard,
  updateStaffProfilePolicy,
  type StaffProfileDashboardDependencies,
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

function makeDashboardDependencies(): StaffProfileDashboardDependencies {
  const base = makeDependencies();
  return {
    ...base,
    guilds: { get: vi.fn().mockResolvedValue({ ownerId: 'owner', mode: GuildMode.Test }) },
    staff: {
      ...base.staff,
      createProfileWithInitialVersion: vi.fn().mockImplementation(async (input) => ({
        profile: { id: profileId, ...input, enabled: true, currentVersionId: 'version-1' },
        version: { id: 'version-1', profileId, version: 1, ...input },
      })),
      updateProfileWithVersion: vi.fn().mockImplementation(async (input) => ({
        profile: { id: input.profileId, ...input, enabled: true, currentVersionId: 'version-2' },
        version: { id: 'version-2', version: 2, ...input, profileName: input.name },
      })),
      listActiveAssignmentsForProfile: vi.fn().mockResolvedValue([]),
      setAssignmentSyncStatus: vi.fn().mockResolvedValue(undefined),
    },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100', ownerId: 'owner', knightUserId: 'knight', knightRolePosition: 50,
        knightPermissions: 0n,
        roles: [{ roleId: 'role-mod', name: 'Moderator', managed: false, position: 20, permissions: 0n },
          { roleId: 'role-new', name: 'New Moderator', managed: false, position: 10, permissions: 0n }],
      }),
      addRole: vi.fn().mockResolvedValue(undefined),
      removeRole: vi.fn().mockResolvedValue(undefined),
    },
  };
}

const createDashboardInput = {
  guildId: '100', name: 'Moderator', discordRoleId: 'role-mod', rank: 20,
} as const;

const editDashboardInput = {
  guildId: '100', profileId, name: 'Senior Moderator', discordRoleId: 'role-new', rank: 25,
} as const;

describe('createStaffProfileFromDashboard', () => {
  it('creates an owner-approved v1 mapped to an existing manageable Discord role', async () => {
    const deps = makeDashboardDependencies();

    const result = await createStaffProfileFromDashboard(
      createDashboardInput,
      { userId: 'owner' },
      deps,
    );

    expect(result.version).toMatchObject({ version: 1, permissions: [], actionPolicies: {} });
    expect(deps.staff.createProfileWithInitialVersion).toHaveBeenCalledWith({
      ...createDashboardInput,
      permissions: [],
      actionPolicies: {},
      createdBy: 'owner',
    });
  });

  it('allows a Security Manager to create only below their Knight rank', async () => {
    const deps = makeDashboardDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);

    await expect(
      createStaffProfileFromDashboard(
        { ...createDashboardInput, rank: 49 },
        { userId: 'manager' },
        deps,
      ),
    ).resolves.toMatchObject({ version: expect.objectContaining({ version: 1 }) });

    await expect(
      createStaffProfileFromDashboard(
        { ...createDashboardInput, rank: 50 },
        { userId: 'manager' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' });
  });

  it.each([
    ['missing', []],
    ['managed', [{ roleId: 'role-mod', name: 'Managed', managed: true, position: 20, permissions: 0n }]],
    ['above Knight', [{ roleId: 'role-mod', name: 'Too high', managed: false, position: 50, permissions: 0n }]],
  ])('rejects a %s Discord role before persistence', async (_caseName, roles) => {
    const deps = makeDashboardDependencies();
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100', ownerId: 'owner', knightUserId: 'knight', knightRolePosition: 50,
      knightPermissions: 0n, roles,
    });

    await expect(
      createStaffProfileFromDashboard(createDashboardInput, { userId: 'owner' }, deps),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^ROLE_/) });
    expect(deps.staff.createProfileWithInitialVersion).not.toHaveBeenCalled();
  });

  it('rejects creation in Guarded mode before Discord lookup or persistence', async () => {
    const deps = makeDashboardDependencies();
    deps.guilds.get = vi.fn().mockResolvedValue({ ownerId: 'owner', mode: GuildMode.Guarded });

    await expect(
      createStaffProfileFromDashboard(createDashboardInput, { userId: 'owner' }, deps),
    ).rejects.toMatchObject({ code: 'GUARDED_PROFILE_MAPPING_LOCKED' });
    expect(deps.discord.getGuildState).not.toHaveBeenCalled();
    expect(deps.staff.createProfileWithInitialVersion).not.toHaveBeenCalled();
  });
});

describe('updateStaffProfileFromDashboard', () => {
  it('creates immutable v2 metadata while preserving policy state', async () => {
    const deps = makeDashboardDependencies();
    const before = await deps.staff.getCurrentProfileVersion('100', profileId);

    const result = await updateStaffProfileFromDashboard(
      editDashboardInput,
      { userId: 'owner' },
      deps,
    );

    expect(result.version).toMatchObject({
      version: 2,
      profileName: 'Senior Moderator',
      discordRoleId: 'role-new',
      rank: 25,
      permissions: ['member.ban'],
      actionPolicies: currentPolicies,
    });
    expect(before).toMatchObject({
      version: 1,
      discordRoleId: 'role-mod',
      rank: 20,
      permissions: ['member.ban'],
    });
  });

  it('denies a Security Manager from increasing the rank of their own profile', async () => {
    const deps = makeDashboardDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);
    deps.staff.getActiveAssignment = vi.fn().mockResolvedValue({
      id: 'self-assignment', guildId: '100', userId: 'manager', profileId,
      profileName: 'Moderator', discordRoleId: 'role-mod', profileRank: 20, syncStatus: 'SYNCED',
    });
    deps.staff.getEffectiveProfile = vi.fn().mockResolvedValue({
      ...(await deps.staff.getCurrentProfileVersion('100', profileId))!,
      id: 'actor-version',
    });

    await expect(
      updateStaffProfileFromDashboard(
        { ...editDashboardInput, discordRoleId: 'role-mod', rank: 21 },
        { userId: 'manager' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'SELF_ESCALATION_DENIED' });
    expect(deps.staff.updateProfileWithVersion).not.toHaveBeenCalled();
  });

  it.each([50, 60])('denies a manager editing a peer/above profile at rank %s', async (rank) => {
    const deps = makeDashboardDependencies();
    deps.managers.isSecurityManager = vi.fn().mockResolvedValue(true);
    deps.staff.getCurrentProfileVersion = vi.fn().mockResolvedValue({
      id: 'target-version', guildId: '100', profileId, version: 1,
      permissions: [], actionPolicies: {}, profileName: 'Target', discordRoleId: 'role-mod', rank,
    });

    await expect(
      updateStaffProfileFromDashboard(
        { ...editDashboardInput, discordRoleId: 'role-mod', rank: 10 },
        { userId: 'manager' },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' });
    expect(deps.staff.updateProfileWithVersion).not.toHaveBeenCalled();
  });

  it('blocks mapped-role changes in Guarded mode but permits metadata edits on the same mapping', async () => {
    const deps = makeDashboardDependencies();
    deps.guilds.get = vi.fn().mockResolvedValue({ ownerId: 'owner', mode: GuildMode.Guarded });

    await expect(
      updateStaffProfileFromDashboard(editDashboardInput, { userId: 'owner' }, deps),
    ).rejects.toMatchObject({ code: 'GUARDED_PROFILE_MAPPING_LOCKED' });
    expect(deps.staff.updateProfileWithVersion).not.toHaveBeenCalled();

    await expect(
      updateStaffProfileFromDashboard(
        { ...editDashboardInput, discordRoleId: 'role-mod' },
        { userId: 'owner' },
        deps,
      ),
    ).resolves.toMatchObject({ version: expect.objectContaining({ version: 2 }) });
  });

  it('resyncs active assignments old-role to new-role after metadata persistence', async () => {
    const deps = makeDashboardDependencies();
    deps.staff.listActiveAssignmentsForProfile = vi.fn().mockResolvedValue([
      { id: 'assignment-1', guildId: '100', userId: 'user-1', profileId, profileName: 'Moderator', discordRoleId: 'role-mod', profileRank: 20, syncStatus: 'SYNCED' },
      { id: 'assignment-2', guildId: '100', userId: 'user-2', profileId, profileName: 'Moderator', discordRoleId: 'role-mod', profileRank: 20, syncStatus: 'SYNCED' },
    ]);

    const result = await updateStaffProfileFromDashboard(
      editDashboardInput,
      { userId: 'owner' },
      deps,
    );

    expect(result.syncStatus).toBe('SYNCED');
    expect(deps.discord.addRole).toHaveBeenCalledTimes(2);
    expect(deps.discord.removeRole).toHaveBeenCalledTimes(2);
    expect(deps.discord.addRole).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', roleId: 'role-new' }));
    expect(deps.discord.removeRole).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', roleId: 'role-mod' }));
    expect(vi.mocked(deps.staff.updateProfileWithVersion).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.discord.addRole).mock.invocationCallOrder[0]!,
    );
    expect(deps.staff.setAssignmentSyncStatus).toHaveBeenCalledWith('100', 'assignment-1', 'SYNCED');
    expect(deps.staff.setAssignmentSyncStatus).toHaveBeenCalledWith('100', 'assignment-2', 'SYNCED');
  });

  it('keeps persisted metadata and marks only failed assignment resyncs NEEDS_REPAIR', async () => {
    const deps = makeDashboardDependencies();
    deps.staff.listActiveAssignmentsForProfile = vi.fn().mockResolvedValue([
      { id: 'assignment-1', guildId: '100', userId: 'user-1', profileId, profileName: 'Moderator', discordRoleId: 'role-mod', profileRank: 20, syncStatus: 'SYNCED' },
      { id: 'assignment-2', guildId: '100', userId: 'user-2', profileId, profileName: 'Moderator', discordRoleId: 'role-mod', profileRank: 20, syncStatus: 'SYNCED' },
    ]);
    deps.discord.addRole = vi.fn()
      .mockRejectedValueOnce(new Error('Discord failed'))
      .mockResolvedValueOnce(undefined);

    const result = await updateStaffProfileFromDashboard(
      editDashboardInput,
      { userId: 'owner' },
      deps,
    );

    expect(result.syncStatus).toBe('NEEDS_REPAIR');
    expect(result.repairAssignmentIds).toEqual(['assignment-1']);
    expect(deps.staff.updateProfileWithVersion).toHaveBeenCalledTimes(1);
    expect(deps.staff.setAssignmentSyncStatus).toHaveBeenCalledWith('100', 'assignment-1', 'NEEDS_REPAIR');
    expect(deps.staff.setAssignmentSyncStatus).toHaveBeenCalledWith('100', 'assignment-2', 'SYNCED');
  });
});

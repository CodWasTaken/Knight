import { describe, expect, it, vi } from 'vitest';
import { RoleSyncService } from './role-sync-service.js';

const moderatorVersion = {
  id: 'version-mod',
  guildId: '100',
  profileId: 'profile-mod',
  version: 1,
  permissions: [],
  actionPolicies: {},
  profileName: 'Moderator',
  discordRoleId: 'role-mod',
  rank: 20,
} as const;

function makeDependencies() {
  return {
    guilds: {
      get: vi.fn().mockResolvedValue({ id: '100', ownerId: '1' }),
    },
    managers: {
      isSecurityManager: vi.fn().mockResolvedValue(false),
    },
    staff: {
      createProfileWithInitialVersion: vi.fn(),
      getCurrentProfileVersion: vi.fn().mockResolvedValue(moderatorVersion),
      getEffectiveProfile: vi.fn().mockResolvedValue(null),
      getActiveAssignment: vi.fn().mockResolvedValue(null),
      assign: vi.fn().mockResolvedValue({ id: 'assignment-1' }),
      deactivateAssignment: vi.fn().mockResolvedValue({ id: 'assignment-1' }),
      setAssignmentSyncStatus: vi.fn().mockResolvedValue(undefined),
      listProfiles: vi.fn().mockResolvedValue([]),
    },
    discord: {
      addRole: vi.fn().mockResolvedValue(undefined),
      removeRole: vi.fn().mockResolvedValue(undefined),
      getMemberState: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('RoleSyncService', () => {
  it('persists an assignment before adding the mapped Discord role', async () => {
    const deps = makeDependencies();
    const service = new RoleSyncService(deps);

    const result = await service.assign({
      guildId: '100',
      actorUserId: '1',
      userId: '42',
      profileId: 'profile-mod',
    });

    expect(result.syncStatus).toBe('SYNCED');
    expect(deps.staff.assign).toHaveBeenCalledTimes(1);
    expect(deps.discord.addRole).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 'role-mod' }),
    );
    const persistOrder = deps.staff.assign.mock.invocationCallOrder[0]!;
    const roleOrder = deps.discord.addRole.mock.invocationCallOrder[0]!;
    expect(persistOrder).toBeLessThan(roleOrder);
    expect(deps.staff.setAssignmentSyncStatus).toHaveBeenCalledWith(
      '100',
      'assignment-1',
      'SYNCED',
    );
  });

  it('keeps the durable assignment and marks repair when Discord role sync fails', async () => {
    const deps = makeDependencies();
    deps.discord.addRole.mockRejectedValueOnce(new Error('Discord unavailable'));
    const service = new RoleSyncService(deps);

    const result = await service.assign({
      guildId: '100',
      actorUserId: '1',
      userId: '42',
      profileId: 'profile-mod',
    });

    expect(result.syncStatus).toBe('NEEDS_REPAIR');
    expect(deps.staff.assign).toHaveBeenCalledTimes(1);
    expect(deps.staff.setAssignmentSyncStatus).toHaveBeenCalledWith(
      '100',
      'assignment-1',
      'NEEDS_REPAIR',
    );
  });
  it('deactivates an assignment before removing the mapped Discord role', async () => {
    const deps = makeDependencies();
    deps.staff.getActiveAssignment.mockResolvedValueOnce({
      id: 'assignment-1',
      guildId: '100',
      userId: '42',
      profileId: 'profile-mod',
      profileName: 'Moderator',
      discordRoleId: 'role-mod',
      profileRank: 20,
      syncStatus: 'SYNCED',
    });
    const service = new RoleSyncService(deps);

    const result = await service.remove({ guildId: '100', actorUserId: '1', userId: '42' });

    expect(result.removed).toBe(true);
    const deactivateOrder = deps.staff.deactivateAssignment.mock.invocationCallOrder[0]!;
    const removeRoleOrder = deps.discord.removeRole.mock.invocationCallOrder[0]!;
    expect(deactivateOrder).toBeLessThan(removeRoleOrder);
    expect(deps.discord.removeRole).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 'role-mod' }),
    );
  });

  it('does not treat a manually added mapped Discord role as Knight authority', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles.mockResolvedValueOnce([
      {
        id: 'profile-mod',
        guildId: '100',
        name: 'Moderator',
        discordRoleId: 'role-mod',
        rank: 20,
        enabled: true,
        currentVersionId: 'version-mod',
      },
    ]);
    deps.discord.getMemberState.mockResolvedValueOnce({
      userId: '42',
      isGuildOwner: false,
      roleIds: ['role-mod'],
      highestRolePosition: 20,
      permissions: 0n,
    });
    const service = new RoleSyncService(deps);
    const result = await service.inspect('100', '42');

    expect(result.assignment).toBeNull();
    expect(result.authoritative).toBe(false);
    expect(result.discordRoleIds).toContain('role-mod');
  });

  it('denies a Security Manager assigning themselves a higher profile', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager.mockResolvedValueOnce(true);
    deps.staff.getEffectiveProfile.mockResolvedValueOnce({
      ...moderatorVersion,
      id: 'version-actor',
      profileId: 'profile-actor',
      rank: 20,
    });
    deps.staff.getCurrentProfileVersion.mockResolvedValueOnce({
      ...moderatorVersion,
      id: 'version-admin',
      profileId: 'profile-admin',
      discordRoleId: 'role-admin',
      rank: 30,
    });
    const service = new RoleSyncService(deps);

    await expect(
      service.assign({
        guildId: '100',
        actorUserId: '42',
        userId: '42',
        profileId: 'profile-admin',
      }),
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' });
    expect(deps.staff.assign).not.toHaveBeenCalled();
  });
  it('denies profile creation to arbitrary non-managers', async () => {
    const deps = makeDependencies();
    const service = new RoleSyncService(deps);

    await expect(
      service.createProfile({
        guildId: '100',
        actorUserId: '42',
        name: 'Helper',
        discordRoleId: 'role-helper',
        rank: 10,
      }),
    ).rejects.toMatchObject({ code: 'STAFF_MANAGEMENT_DENIED' });
    expect(deps.staff.createProfileWithInitialVersion).not.toHaveBeenCalled();
  });

  it('allows an explicit Security Manager to create a lower zero-permission profile', async () => {
    const deps = makeDependencies();
    deps.managers.isSecurityManager.mockResolvedValueOnce(true);
    deps.staff.getEffectiveProfile.mockResolvedValueOnce({
      ...moderatorVersion,
      id: 'version-manager',
      profileId: 'profile-manager',
      rank: 50,
    });
    deps.staff.createProfileWithInitialVersion.mockResolvedValueOnce({
      profile: { id: 'profile-helper' },
      version: { id: 'version-helper' },
    });
    const service = new RoleSyncService(deps);

    await service.createProfile({
      guildId: '100',
      actorUserId: '42',
      name: 'Helper',
      discordRoleId: 'role-helper',
      rank: 10,
    });
    expect(deps.staff.createProfileWithInitialVersion).toHaveBeenCalledWith({
      guildId: '100',
      name: 'Helper',
      discordRoleId: 'role-helper',
      rank: 10,
      permissions: [],
      actionPolicies: {},
      createdBy: '42',
    });
  });

  it('authorizes the actor before resolving a profile reference', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles.mockResolvedValue([
      {
        id: 'profile-mod',
        guildId: '100',
        name: 'Moderator',
        discordRoleId: 'role-mod',
        rank: 20,
        enabled: true,
        currentVersionId: 'version-mod',
      },
    ]);
    const service = new RoleSyncService(deps);

    await expect(
      service.assignByReference({
        guildId: '100',
        actorUserId: '42',
        userId: '77',
        profileReference: 'Moderator',
      }),
    ).rejects.toMatchObject({ code: 'STAFF_MANAGEMENT_DENIED' });

    expect(deps.staff.listProfiles).not.toHaveBeenCalled();
    expect(deps.staff.assign).not.toHaveBeenCalled();
  });

  it('prefers an exact profile name before case-insensitive fallback', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles.mockResolvedValue([
      {
        id: 'profile-upper',
        guildId: '100',
        name: 'Moderator',
        discordRoleId: 'role-upper',
        rank: 20,
        enabled: true,
        currentVersionId: 'version-upper',
      },
      {
        id: 'profile-lower',
        guildId: '100',
        name: 'moderator',
        discordRoleId: 'role-lower',
        rank: 10,
        enabled: true,
        currentVersionId: 'version-lower',
      },
    ]);
    deps.staff.getCurrentProfileVersion.mockResolvedValueOnce({
      ...moderatorVersion,
      profileId: 'profile-lower',
      discordRoleId: 'role-lower',
      rank: 10,
    });
    const service = new RoleSyncService(deps);

    await service.assignByReference({
      guildId: '100',
      actorUserId: '1',
      userId: '42',
      profileReference: 'moderator',
    });

    expect(deps.staff.assign).toHaveBeenCalledWith({
      guildId: '100',
      userId: '42',
      profileId: 'profile-lower',
      actorUserId: '1',
    });
  });

  it('rejects an ambiguous case-insensitive profile reference', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles.mockResolvedValue([
      {
        id: 'profile-upper',
        guildId: '100',
        name: 'Moderator',
        discordRoleId: 'role-upper',
        rank: 20,
        enabled: true,
        currentVersionId: 'version-upper',
      },
      {
        id: 'profile-lower',
        guildId: '100',
        name: 'moderator',
        discordRoleId: 'role-lower',
        rank: 10,
        enabled: true,
        currentVersionId: 'version-lower',
      },
    ]);
    const service = new RoleSyncService(deps);

    await expect(
      service.assignByReference({
        guildId: '100',
        actorUserId: '1',
        userId: '42',
        profileReference: 'MODERATOR',
      }),
    ).rejects.toMatchObject({ code: 'PROFILE_REFERENCE_AMBIGUOUS' });
    expect(deps.staff.assign).not.toHaveBeenCalled();
  });

  it('resolves assignment profiles by ID or case-insensitive name', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles.mockResolvedValue([
      {
        id: 'profile-mod',
        guildId: '100',
        name: 'Moderator',
        discordRoleId: 'role-mod',
        rank: 20,
        enabled: true,
        currentVersionId: 'version-mod',
      },
    ]);
    const service = new RoleSyncService(deps);

    await service.assignByReference({
      guildId: '100',
      actorUserId: '1',
      userId: '42',
      profileReference: 'profile-mod',
    });
    await service.assignByReference({
      guildId: '100',
      actorUserId: '1',
      userId: '43',
      profileReference: 'moderator',
    });

    expect(deps.staff.assign).toHaveBeenNthCalledWith(1, {
      guildId: '100',
      userId: '42',
      profileId: 'profile-mod',
      actorUserId: '1',
    });
    expect(deps.staff.assign).toHaveBeenNthCalledWith(2, {
      guildId: '100',
      userId: '43',
      profileId: 'profile-mod',
      actorUserId: '1',
    });
  });
});

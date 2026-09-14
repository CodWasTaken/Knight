import { GuildMode } from '@knight/contracts';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  GuardedMigrationError,
  GuardedMigrationService,
  type GuardedMigrationDependencies,
} from './guarded-migration-service.js';

const ban = PermissionFlagsBits.BanMembers;
const kick = PermissionFlagsBits.KickMembers;
const manageMessages = PermissionFlagsBits.ManageMessages;
const manageRoles = PermissionFlagsBits.ManageRoles;
const beforePermissions = ban | kick | manageMessages;
function makeDependencies(): GuardedMigrationDependencies {
  return {
    guilds: {
      get: vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Test }),
      saveRolePermissionSnapshot: vi.fn().mockResolvedValue(undefined),
      getLatestRolePermissionSnapshots: vi.fn().mockResolvedValue([]),
      getGuardedCategory: vi.fn().mockResolvedValue(null),
      getSetupState: vi.fn().mockResolvedValue({ guildId: '100', step: 'COMPLETE', completedSteps: [], updatedAt: new Date() }),
      setGuardedBanState: vi.fn().mockResolvedValue(undefined),
    },
    staff: {
      listProfiles: vi
        .fn()
        .mockResolvedValue([
          { id: 'profile-1', guildId: '100', discordRoleId: 'role-1', rank: 20, enabled: true },
        ]),
      getCurrentProfileVersion: vi.fn().mockResolvedValue({
        id: 'version-1',
        guildId: '100',
        profileId: 'profile-1',
        version: 1,
        permissions: ['member.ban'],
        actionPolicies: {},
      }),
      listActiveAssignmentsForProfile: vi.fn().mockResolvedValue([{ userId: '42' }]),
    },
    security: {
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
    discord: {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: 'owner',
        knightUserId: 'knight',
        knightRolePosition: 50,
        knightPermissions: manageRoles,
        roles: [{ roleId: 'role-1', position: 20, permissions: beforePermissions }],
      }),
      setRolePermissions: vi.fn().mockResolvedValue(undefined),
    },
    securityRecorder: { record: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }) },
    createMigrationId: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
  };
}

describe('GuardedMigrationService', () => {
  it('blocks Guarded permission mutations during roles Lockdown', async () => {
    const deps = makeDependencies();
    vi.mocked(deps.security.getSecurityState).mockResolvedValueOnce({
      mode: 'LOCKDOWN',
      lockedScopes: ['ROLES'],
    } as never);

    await expect(
      new GuardedMigrationService(deps).enableBanGuard({
        guildId: '100',
        actorUserId: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'EMERGENCY_STATE_BLOCKED' });
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
  });

  it('requires TEST mode before Guarded preview', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi
      .fn()
      .mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Observe });
    const service = new GuardedMigrationService(deps);

    await expect(service.previewBanGuard('100')).rejects.toMatchObject({
      code: 'TEST_MODE_REQUIRED',
    });
    expect(deps.discord.getGuildState).not.toHaveBeenCalled();
  });
  it('previews exact guarded native permission removal while preserving unrelated permissions', async () => {
    const deps = makeDependencies();
    const service = new GuardedMigrationService(deps);

    const preview = await service.previewBanGuard('100');

    expect(preview.blocked).toBe(false);
    expect(preview.staffCount).toBe(1);
    expect(preview.roles).toEqual([
      expect.objectContaining({
        profileIds: ['profile-1'],
        roleId: 'role-1',
        manageable: true,
        beforePermissions,
        afterPermissions: 0n,
      }),
    ]);
  });

  it('blocks preview when Knight lacks Manage Roles', async () => {
    const deps = makeDependencies();
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 50,
      knightPermissions: 0n,
      roles: [{ roleId: 'role-1', position: 20, permissions: beforePermissions }],
    });
    const preview = await new GuardedMigrationService(deps).previewBanGuard('100');
    expect(preview.blocked).toBe(true);
    expect(preview.roles[0]).toMatchObject({
      manageable: false,
      blockReason: 'KNIGHT_MANAGE_ROLES_REQUIRED',
    });
  });
  it('blocks preview when an affected role is at or above Knight hierarchy', async () => {
    const deps = makeDependencies();
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 20,
      knightPermissions: manageRoles,
      roles: [{ roleId: 'role-1', position: 20, permissions: beforePermissions }],
    });
    const preview = await new GuardedMigrationService(deps).previewBanGuard('100');
    expect(preview.blocked).toBe(true);
    expect(preview.roles[0]).toMatchObject({
      manageable: false,
      blockReason: 'ROLE_HIERARCHY_BLOCKED',
    });
  });

  it('activates Guarded as a durable no-op when no mapped role needs native permission removal', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles = vi.fn().mockResolvedValue([]);

    await new GuardedMigrationService(deps).enableBanGuard({ guildId: '100', actorUserId: 'owner' });

    expect(deps.guilds.saveRolePermissionSnapshot).not.toHaveBeenCalled();
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
    expect(deps.guilds.setGuardedBanState).toHaveBeenCalledWith(
      '100', true, GuildMode.Guarded, 'owner', { migrationId: null, snapshotRequired: false },
    );
    expect(deps.securityRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'guarded.enable', metadata: expect.objectContaining({ snapshotRequired: false, roleCount: 0 }) }),
      'SECURITY',
    );
  });

  it('requires the guild owner to enable Guarded mode', async () => {
    const deps = makeDependencies();
    const service = new GuardedMigrationService(deps);

    await expect(
      service.enableBanGuard({ guildId: '100', actorUserId: 'manager' }),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
    expect(deps.guilds.saveRolePermissionSnapshot).not.toHaveBeenCalled();
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
  });
  it('performs zero persistence or Discord mutations when preview is blocked', async () => {
    const deps = makeDependencies();
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 20,
      knightPermissions: manageRoles,
      roles: [{ roleId: 'role-1', position: 20, permissions: beforePermissions }],
    });
    const service = new GuardedMigrationService(deps);

    await expect(
      service.enableBanGuard({ guildId: '100', actorUserId: 'owner' }),
    ).rejects.toMatchObject({ code: 'MIGRATION_BLOCKED' });
    expect(deps.guilds.saveRolePermissionSnapshot).not.toHaveBeenCalled();
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
    expect(deps.guilds.setGuardedBanState).not.toHaveBeenCalled();
  });

  it('persists every snapshot before the first Discord role mutation', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles = vi.fn().mockResolvedValue([
      { id: 'profile-1', guildId: '100', discordRoleId: 'role-1', rank: 20, enabled: true },
      { id: 'profile-2', guildId: '100', discordRoleId: 'role-2', rank: 10, enabled: true },
    ]);
    deps.staff.getCurrentProfileVersion = vi
      .fn()
      .mockImplementation(async (_guildId, profileId) => ({
        id: `${profileId}-v1`,
        guildId: '100',
        profileId,
        version: 1,
        permissions: ['member.ban'],
        actionPolicies: {},
      }));
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 50,
      knightPermissions: manageRoles,
      roles: [
        { roleId: 'role-1', position: 20, permissions: beforePermissions },
        {
          roleId: 'role-2',
          position: 10,
          permissions: beforePermissions | PermissionFlagsBits.ModerateMembers,
        },
      ],
    });
    const service = new GuardedMigrationService(deps);
    await service.enableBanGuard({ guildId: '100', actorUserId: 'owner' });

    expect(deps.guilds.saveRolePermissionSnapshot).toHaveBeenCalledTimes(2);
    expect(deps.discord.setRolePermissions).toHaveBeenCalledTimes(2);
    const snapshotOrders = vi.mocked(deps.guilds.saveRolePermissionSnapshot).mock
      .invocationCallOrder;
    const mutationOrders = vi.mocked(deps.discord.setRolePermissions).mock.invocationCallOrder;
    expect(Math.max(...snapshotOrders)).toBeLessThan(Math.min(...mutationOrders));
    expect(deps.guilds.setGuardedBanState).toHaveBeenCalledWith(
      '100',
      true,
      GuildMode.Guarded,
      'owner',
      { migrationId: '11111111-1111-4111-8111-111111111111', snapshotRequired: true },
    );
    expect(deps.securityRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'guarded.enable',
        actorUserId: 'owner',
        metadata: expect.objectContaining({ migrationId: '11111111-1111-4111-8111-111111111111' }),
      }),
      'SECURITY',
    );
  });

  it('compensates from snapshots when a Discord migration write fails before activation', async () => {
    const deps = makeDependencies();
    deps.staff.listProfiles = vi.fn().mockResolvedValue([
      { id: 'profile-1', guildId: '100', discordRoleId: 'role-1', rank: 20, enabled: true },
      { id: 'profile-2', guildId: '100', discordRoleId: 'role-2', rank: 10, enabled: true },
    ]);
    deps.staff.getCurrentProfileVersion = vi
      .fn()
      .mockImplementation(async (_guildId, profileId) => ({
        id: `${profileId}-v1`,
        guildId: '100',
        profileId,
        version: 1,
        permissions: ['member.ban'],
        actionPolicies: {},
      }));
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 50,
      knightPermissions: manageRoles,
      roles: [
        { roleId: 'role-1', position: 20, permissions: beforePermissions },
        {
          roleId: 'role-2',
          position: 10,
          permissions: beforePermissions | PermissionFlagsBits.ModerateMembers,
        },
      ],
    });
    deps.discord.setRolePermissions = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('discord failed'))
      .mockResolvedValue(undefined);

    await expect(
      new GuardedMigrationService(deps).enableBanGuard({ guildId: '100', actorUserId: 'owner' }),
    ).rejects.toMatchObject({ code: 'DISCORD_MIGRATION_FAILED' });

    expect(deps.discord.setRolePermissions).toHaveBeenCalledTimes(4);
    expect(deps.discord.setRolePermissions).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        roleId: 'role-1',
        permissions: beforePermissions,
      }),
    );
    expect(deps.discord.setRolePermissions).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        roleId: 'role-2',
        permissions: beforePermissions | PermissionFlagsBits.ModerateMembers,
      }),
    );
    expect(deps.guilds.setGuardedBanState).not.toHaveBeenCalled();
  });

  it('rolls back using the exact saved permission bigint and returns to TEST', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi
      .fn()
      .mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Guarded });
    deps.guilds.getLatestRolePermissionSnapshots = vi
      .fn()
      .mockResolvedValue([
        { migrationId: 'migration-1', roleId: 'role-1', permissions: '900719925474099312345' },
      ]);
    const service = new GuardedMigrationService(deps);

    await service.rollbackBanGuard({ guildId: '100', actorUserId: 'owner' });

    expect(deps.discord.setRolePermissions).toHaveBeenCalledWith({
      guildId: '100',
      roleId: 'role-1',
      permissions: 900719925474099312345n,
      reason: expect.stringContaining('rollback'),
    });
    expect(deps.guilds.setGuardedBanState).toHaveBeenCalledWith(
      '100',
      false,
      GuildMode.Test,
      'owner',
      { migrationId: null, snapshotRequired: false },
    );
    expect(deps.securityRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'guarded.rollback', actorUserId: 'owner' }),
      'SECURITY',
    );
  });

  it('rolls back a no-op Guarded activation without snapshots or Discord writes', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Guarded });
    deps.guilds.getGuardedCategory = vi.fn().mockResolvedValue({
      guildId: '100', category: 'MEMBER_BAN', enabled: true,
      migrationId: null, snapshotRequired: false,
    });
    await new GuardedMigrationService(deps).rollbackBanGuard({ guildId: '100', actorUserId: 'owner' });
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
    expect(deps.guilds.setGuardedBanState).toHaveBeenCalledWith(
      '100', false, GuildMode.Test, 'owner', { migrationId: null, snapshotRequired: false },
    );
  });

  it('still refuses rollback when a real migration has lost its snapshots', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Guarded });
    deps.guilds.getGuardedCategory = vi.fn().mockResolvedValue({
      guildId: '100', category: 'MEMBER_BAN', enabled: true,
      migrationId: 'migration-1', snapshotRequired: true,
    });
    await expect(new GuardedMigrationService(deps).rollbackBanGuard({ guildId: '100', actorUserId: 'owner' }))
      .rejects.toMatchObject({ code: 'ROLLBACK_SNAPSHOT_MISSING' });
  });

  it('rechecks setup completion before Guarded activation', async () => {
    const deps = makeDependencies();
    deps.guilds.getSetupState = vi.fn().mockResolvedValue({ guildId: '100', step: 'BACKUPS', completedSteps: [], updatedAt: new Date() });
    await expect(new GuardedMigrationService(deps).enableBanGuard({ guildId: '100', actorUserId: 'owner' }))
      .rejects.toMatchObject({ code: 'SETUP_COMPLETE_REQUIRED' });
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
  });

  it('does not allow non-owners to roll back Guarded permissions', async () => {
    const deps = makeDependencies();
    deps.guilds.get = vi
      .fn()
      .mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Guarded });
    await expect(
      new GuardedMigrationService(deps).rollbackBanGuard({
        guildId: '100',
        actorUserId: 'manager',
      }),
    ).rejects.toBeInstanceOf(GuardedMigrationError);
    expect(deps.discord.setRolePermissions).not.toHaveBeenCalled();
  });
});

describe('expanded Guarded native permission replacement', () => {
  it.each([
    ['BanMembers', PermissionFlagsBits.BanMembers],
    ['KickMembers', PermissionFlagsBits.KickMembers],
    ['ModerateMembers', PermissionFlagsBits.ModerateMembers],
    ['ManageMessages', PermissionFlagsBits.ManageMessages],
  ])('removes %s from a mapped staff role', async (_name, guardedBit) => {
    const deps = makeDependencies();
    const unrelated = PermissionFlagsBits.ViewAuditLog;
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 50,
      knightPermissions: manageRoles,
      roles: [{ roleId: 'role-1', position: 20, permissions: guardedBit | unrelated }],
    });

    const preview = await new GuardedMigrationService(deps).previewBanGuard('100');

    expect(preview.roles).toEqual([
      expect.objectContaining({
        roleId: 'role-1',
        beforePermissions: guardedBit | unrelated,
        afterPermissions: unrelated,
      }),
    ]);
  });

  it('unions all guarded native bits into one role mutation and one snapshot', async () => {
    const deps = makeDependencies();
    const guardedMask =
      PermissionFlagsBits.BanMembers |
      PermissionFlagsBits.KickMembers |
      PermissionFlagsBits.ModerateMembers |
      PermissionFlagsBits.ManageMessages;
    const unrelated = PermissionFlagsBits.ViewAuditLog;
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 50,
      knightPermissions: manageRoles,
      roles: [{ roleId: 'role-1', position: 20, permissions: guardedMask | unrelated }],
    });

    await new GuardedMigrationService(deps).enableBanGuard({
      guildId: '100',
      actorUserId: 'owner',
    });

    expect(deps.guilds.saveRolePermissionSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.discord.setRolePermissions).toHaveBeenCalledTimes(1);
    expect(deps.discord.setRolePermissions).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 'role-1', permissions: unrelated }),
    );
  });

  it('strips guarded native permissions even when the mapped profile grants no replacement action', async () => {
    const deps = makeDependencies();
    deps.staff.getCurrentProfileVersion = vi.fn().mockResolvedValue({
      id: 'version-1',
      guildId: '100',
      profileId: 'profile-1',
      version: 1,
      permissions: [],
      actionPolicies: {},
    });
    deps.discord.getGuildState = vi.fn().mockResolvedValue({
      guildId: '100',
      ownerId: 'owner',
      knightUserId: 'knight',
      knightRolePosition: 50,
      knightPermissions: manageRoles,
      roles: [{ roleId: 'role-1', position: 20, permissions: PermissionFlagsBits.KickMembers }],
    });

    const preview = await new GuardedMigrationService(deps).previewBanGuard('100');

    expect(preview.roles).toEqual([
      expect.objectContaining({
        roleId: 'role-1',
        beforePermissions: PermissionFlagsBits.KickMembers,
        afterPermissions: 0n,
      }),
    ]);
  });
});

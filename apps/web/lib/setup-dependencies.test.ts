import { GuardedMigrationService, SetupService } from '@knight/bot/setup';
import { GuildMode } from '@knight/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createWebSetupServices } from './setup-dependencies';

function fakeRepositories() {
  return {
    guilds: {
      get: vi.fn().mockResolvedValue({ id: '100', ownerId: 'owner', mode: GuildMode.Test }),
      getSetupState: vi.fn(),
      updateSetupState: vi.fn(),
      setMode: vi.fn(),
      saveRolePermissionSnapshot: vi.fn(),
      getLatestRolePermissionSnapshots: vi.fn(),
      setGuardedBanState: vi.fn(),
    },
    managers: {
      isSecurityManager: vi.fn(),
      listSecurityManagers: vi.fn(),
    },
    staff: {
      listProfiles: vi.fn().mockResolvedValue([]),
      getCurrentProfileVersion: vi.fn(),
      listActiveAssignmentsForProfile: vi.fn(),
    },
    securityLedger: {
      append: vi.fn().mockResolvedValue({ entryHash: 'ledger-hash' }),
      getLoggingSettings: vi.fn().mockResolvedValue(null),
    },
    security: {
      getSecurityState: vi.fn().mockResolvedValue({ mode: 'NORMAL', lockedScopes: [] }),
    },
  };
}

describe('createWebSetupServices', () => {
  it('composes the tested setup services with the supplied REST Discord port', async () => {
    const repositories = fakeRepositories();
    const discord = {
      getGuildState: vi.fn().mockResolvedValue({
        guildId: '100',
        ownerId: 'owner',
        knightUserId: 'knight',
        knightRolePosition: 50,
        knightPermissions: 0n,
        roles: [],
      }),
      setRolePermissions: vi.fn(),
      sendChannelMessage: vi.fn(),
    };
    const services = createWebSetupServices({
      repositories: repositories as never,
      discord,
      createMigrationId: () => '11111111-1111-4111-8111-111111111111',
    });
    expect(services.setup).toBeInstanceOf(SetupService);
    expect(services.migrations).toBeInstanceOf(GuardedMigrationService);

    await services.migrations.previewBanGuard('100');
    expect(discord.getGuildState).toHaveBeenCalledWith('100');
  });

  it('records Guarded changes made through the web setup service', async () => {
    const repositories = fakeRepositories();
    repositories.guilds.get.mockResolvedValue({
      id: '100',
      ownerId: 'owner',
      mode: GuildMode.Guarded,
    });
    repositories.guilds.getLatestRolePermissionSnapshots.mockResolvedValue([
      { migrationId: 'migration-1', roleId: 'staff-role', permissions: '8' },
    ]);
    const discord = {
      getGuildState: vi.fn(),
      setRolePermissions: vi.fn().mockResolvedValue(undefined),
      sendChannelMessage: vi.fn().mockResolvedValue(undefined),
    };
    const services = createWebSetupServices({
      repositories: repositories as never,
      discord: discord as never,
      createMigrationId: () => '11111111-1111-4111-8111-111111111111',
    });

    await services.migrations.rollbackBanGuard({ guildId: '100', actorUserId: 'owner' });

    expect(repositories.securityLedger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: '100',
        action: 'guarded.rollback',
        actorUserId: 'owner',
      }),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { SecurityManagerService } from './security/security-manager-service.js';
import { GuardedMigrationService } from './setup/guarded-migration-service.js';
import { SetupService } from './setup/setup-service.js';
import { RoleSyncService } from './staff/role-sync-service.js';
import {
  createCommandRouterDependencies,
  installGuildOwnerSync,
  syncConnectedGuildOwners,
} from './index.js';

function fakeDiscord() {
  return {
    banMember: vi.fn(),
    kickMember: vi.fn(),
    timeoutMember: vi.fn(),
    unbanMember: vi.fn(),
    sendDirectMessage: vi.fn(),
    fetchRecentMessages: vi.fn(),
    deleteMessages: vi.fn(),
    addRole: vi.fn(),
    removeRole: vi.fn(),
    getMemberState: vi.fn(),
    getGuildState: vi.fn(),
    setRolePermissions: vi.fn(),
  };
}

describe('guild onboarding sync', () => {
  it('persists every connected guild owner before setup is used', async () => {
    const createOrUpdateOwner = vi.fn().mockResolvedValue(undefined);
    const client = {
      guilds: {
        cache: new Map([
          ['100', { id: '100', ownerId: 'owner-100' }],
          ['200', { id: '200', ownerId: 'owner-200' }],
        ]),
      },
    };

    await syncConnectedGuildOwners(client as never, { createOrUpdateOwner });

    expect(createOrUpdateOwner).toHaveBeenCalledTimes(2);
    expect(createOrUpdateOwner).toHaveBeenCalledWith('100', 'owner-100');
    expect(createOrUpdateOwner).toHaveBeenCalledWith('200', 'owner-200');
  });

  it('persists a guild owner when Knight is invited after startup', async () => {
    const createOrUpdateOwner = vi.fn().mockResolvedValue(undefined);
    let guildCreate: ((guild: { id: string; ownerId: string }) => void) | undefined;
    const client = {
      on: vi.fn((event: string, handler: (guild: { id: string; ownerId: string }) => void) => {
        if (event === 'guildCreate') guildCreate = handler;
      }),
    };

    installGuildOwnerSync(client as never, { createOrUpdateOwner });
    guildCreate?.({ id: '300', ownerId: 'owner-300' });
    await vi.waitFor(() => expect(createOrUpdateOwner).toHaveBeenCalledWith('300', 'owner-300'));
  });
});

describe('bot production composition', () => {
  it('wires Task 9 staff and Security Manager services into the command router', () => {
    const discord = fakeDiscord();
    const dependencies = createCommandRouterDependencies({
      database: {} as never,
      redis: {} as never,
      discord,
      appUrl: 'https://knight.example.com',
      createCorrelationId: () => 'corr-1',
    });

    expect(dependencies.roleSync).toBeInstanceOf(RoleSyncService);
    expect(dependencies.securityManagers).toBeInstanceOf(SecurityManagerService);
    expect(dependencies.setup.setup).toBeInstanceOf(SetupService);
    expect(dependencies.setup.migrations).toBeInstanceOf(GuardedMigrationService);
    expect(dependencies.memberBan.discord).toBe(discord);
    expect(dependencies.doctor.discord).toBe(discord);
    expect(dependencies.doctor.appUrl).toBe('https://knight.example.com');
  });
});

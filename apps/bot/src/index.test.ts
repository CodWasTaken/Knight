import { describe, expect, it, vi } from 'vitest';
import { SecurityManagerService } from './security/security-manager-service.js';
import { RoleSyncService } from './staff/role-sync-service.js';
import { createCommandRouterDependencies } from './index.js';

function fakeDiscord() {
  return {
    banMember: vi.fn(),
    addRole: vi.fn(),
    removeRole: vi.fn(),
    getMemberState: vi.fn(),
    getGuildState: vi.fn(),
    setRolePermissions: vi.fn(),
  };
}

describe('bot production composition', () => {
  it('wires Task 9 staff and Security Manager services into the command router', () => {
    const discord = fakeDiscord();
    const dependencies = createCommandRouterDependencies({
      database: {} as never,
      redis: {} as never,
      discord,
      createCorrelationId: () => 'corr-1',
    });

    expect(dependencies.roleSync).toBeInstanceOf(RoleSyncService);
    expect(dependencies.securityManagers).toBeInstanceOf(SecurityManagerService);
    expect(dependencies.memberBan.discord).toBe(discord);
  });
});

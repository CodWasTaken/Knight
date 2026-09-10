import { PermissionFlagsBits, Routes } from 'discord-api-types/v10';
import { describe, expect, it, vi } from 'vitest';

const ALL_KNOWN_PERMISSIONS = Object.values(PermissionFlagsBits).reduce(
  (combined, permission) => combined | permission,
  0n,
);
import { DiscordRestSetupAdapter } from './rest-setup-adapter.js';

describe('DiscordRestSetupAdapter', () => {
  it('reads live guild role state and expands Administrator into effective permissions', async () => {
    const get = vi.fn().mockImplementation(async (route: string) => {
      if (route === Routes.user()) return { id: 'knight' };
      if (route === Routes.guild('100')) return { id: '100', owner_id: 'owner' };
      if (route === Routes.guildMember('100', 'knight')) return { roles: ['role-knight'] };
      if (route === Routes.guildRoles('100')) {
        return [
          { id: '100', position: 0, permissions: '0' },
          {
            id: 'role-knight',
            position: 50,
            permissions: PermissionFlagsBits.Administrator.toString(),
          },
          {
            id: 'role-staff',
            position: 20,
            permissions: PermissionFlagsBits.BanMembers.toString(),
          },
        ];
      }
      throw new Error(`unexpected route ${route}`);
    });
    const adapter = new DiscordRestSetupAdapter({ get, patch: vi.fn() });
    const state = await adapter.getGuildState('100');

    expect(state.ownerId).toBe('owner');
    expect(state.knightRolePosition).toBe(50);
    expect(state.knightPermissions).toBe(ALL_KNOWN_PERMISSIONS);
    expect(state.roles).toContainEqual({
      roleId: 'role-staff',
      position: 20,
      permissions: PermissionFlagsBits.BanMembers,
    });
  });

  it('writes exact permission bigint strings with an audit reason', async () => {
    const patch = vi.fn().mockResolvedValue({});
    const adapter = new DiscordRestSetupAdapter({ get: vi.fn(), patch });

    await adapter.setRolePermissions({
      guildId: '100',
      roleId: 'role-staff',
      permissions: 900719925474099312345n,
      reason: 'Knight Guarded migration',
    });

    expect(patch).toHaveBeenCalledWith(Routes.guildRole('100', 'role-staff'), {
      body: { permissions: '900719925474099312345' },
      reason: 'Knight Guarded migration',
    });
  });
});
